# BibzCode CLI v7.8.0 — Entry Point

import argparse
import atexit
import os
import shutil
import shlex
import subprocess
import sys
import threading
import time
import tempfile
import warnings

warnings.filterwarnings("ignore")

from rich.progress import (
    BarColumn,
    Progress,
    SpinnerColumn,
    TextColumn,
    TimeElapsedColumn,
    TimeRemainingColumn,
)

from .memory import delete_session, list_sessions, new_session_id
from .repl import main as repl_main
from .ui import console
from .version import __version__

def _close_selenium_session_lazy():
    """Avoid importing the optional browser stack during normal startup."""
    try:
        from .selenium_browser import close_selenium_session
        close_selenium_session()
    except Exception:
        pass


# Ensure orphaned browser sessions are closed on exit.
atexit.register(_close_selenium_session_lazy)

CLI_EPILOG = '''Examples:
  bzcli                          Start the interactive CLI
  bzcli help                     Show CLI help
  bzcli list session            List saved sessions
  bzcli -s bzcli-xxxxxxxxxxxx   Resume a saved session
  bzcli -d bzcli-xxxxxxxxxxxx   Delete a saved session
  bzcli install find-skills     Install a skill package

Inside the interactive REPL use /help for the full slash-command reference.
'''


def _build_parser():
    parser = argparse.ArgumentParser(
        prog='bzcli',
        description=f'BibzCode CLI Agent v{__version__}',
        epilog=CLI_EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('-s', '--session', metavar='SESSION_ID',
                        help='Continue an existing session (e.g. bzcli-xxxxxxxxxxxx)')
    parser.add_argument('-d', '--delete', metavar='SESSION_ID',
                        help='Delete a saved session')
    parser.add_argument('-l', '--list', action='store_true',
                        help='List all saved sessions')
    parser.add_argument('--uninstall-full', action='store_true',
                        help='Completely uninstall BibzCode CLI (config, sessions, logs, wrapper)')
    parser.add_argument('command', nargs='*',
                        help='Commands: help | list session | delete <id> | logout | uninstall-full')
    return parser


def _run_cmd_with_progress(cmd, desc='Running', stdin_input='y\n'):
    # Auto-add --yes right after npx to skip "Ok to proceed?" prompt
    if cmd and cmd[0] == 'npx':
        cmd = [cmd[0], '--yes'] + cmd[1:]

    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    # Pipe auto-answer then close stdin immediately
    if proc.stdin and not proc.stdin.closed:
        if stdin_input:
            try:
                proc.stdin.write(stdin_input)
            except OSError:
                pass
        try:
            proc.stdin.close()
        except OSError:
            pass

    # Drain stdout/stderr via threads to prevent pipe buffer deadlock
    stdout_lines = []
    stderr_lines = []

    def _drain(stream, target):
        for line in iter(stream.readline, ''):
            target.append(line)
        stream.close()

    t_out = threading.Thread(target=_drain, args=(proc.stdout, stdout_lines), daemon=True)
    t_err = threading.Thread(target=_drain, args=(proc.stderr, stderr_lines), daemon=True)
    t_out.start()
    t_err.start()

    with Progress(
        SpinnerColumn(),
        TextColumn('[progress.description]{task.description}'),
        BarColumn(bar_width=20),
        TextColumn('[progress.percentage]{task.percentage:>3.0f}%'),
        TimeElapsedColumn(),
        TextColumn('\u2022'),
        TimeRemainingColumn(),
        console=console,
        transient=False,
    ) as progress:
        task = progress.add_task(f'[cyan]{desc}[/cyan]', total=100)

        start = time.time()
        last_count = 0
        while proc.poll() is None:
            time.sleep(0.2)
            elapsed = time.time() - start
            pct = min(95, elapsed / 3 * 10)
            progress.update(task, completed=pct, total=100)
            count = len(stdout_lines) + len(stderr_lines)
            if count > last_count:
                all_lines = stdout_lines + stderr_lines
                latest = all_lines[-1].strip()
                if latest and len(latest) > 5:
                    progress.update(task, description=f'[cyan]{desc}[/cyan] [dim]{latest[:60]}[/dim]')
                last_count = count

        t_out.join(timeout=3)
        t_err.join(timeout=3)
        elapsed = time.time() - start
        progress.update(task, completed=100, total=100,
                        description=f'[cyan]{desc}[/cyan] [green]done ({elapsed:.1f}s)[/green]')

    return proc.returncode, stdout_lines, stderr_lines


def _cmd_list():
    """List all saved sessions."""
    sessions = list_sessions()
    if not sessions:
        print('No saved sessions.')
        return
    print(f'Saved sessions ({len(sessions)}):')
    for s in sessions:
        c = s.get('created_at', '?')[:19]
        u = s.get('updated_at', '?')[:19]
        n = s.get('message_count', 0)
        print(f'  {s["session_id"]}  [{n} msgs]  created: {c}  updated: {u}')


def _cmd_delete(session_id: str):
    """Delete a session by ID."""
    if delete_session(session_id):
        print(f'Session {session_id} deleted.')
    else:
        print(f'Session {session_id} not found.', file=sys.stderr)
        sys.exit(1)


def _cmd_install_skill(package: str):
    """Install a skill via npx skills CLI with real-time progress."""
    console.print(f'  [bold cyan]Installing skill:[/bold cyan] {package}')
    console.print()

    cmd = ['npx', '--yes', 'skills', 'add', package]
    rc, out, err = _run_cmd_with_progress(cmd, f'npx skills add {package}')

    if rc == 0:
        console.print(f'  [green]✓ Skill "{package}" installed successfully.[/green]')
        out_text = ''.join(out[-5:]).strip()
        if out_text:
            for line in out_text.split('\n'):
                console.print(f'    [dim]{line}[/dim]')
        return True

    err_text = ''.join(err[-3:]).strip()
    if err_text:
        console.print(f'  [red]✗ npx failed:[/red] [dim]{err_text[:200]}[/dim]')
    console.print(f'  [yellow]Trying: npm install -g {package}[/yellow]')

    cmd2 = ['npm', 'install', '-g', package]
    rc2, _out2, err2 = _run_cmd_with_progress(cmd2, f'npm install -g {package}')

    if rc2 == 0:
        console.print(f'  [green]✓ Package "{package}" installed globally.[/green]')
        return True

    err2_text = ''.join(err2[-3:]).strip()
    if err2_text:
        console.print(f'  [red]✗ npm also failed:[/red] [dim]{err2_text[:200]}[/dim]')
    return False

def _cmd_uninstall_full():
    """Full uninstall: remove config, sessions, logs, install dir, wrapper, PATH entries."""

    # 1. Remove config directory
    config_dir = os.path.expanduser('~/.bibzcode-cli')
    if os.path.exists(config_dir):
        print(f'Removing config directory: {config_dir}')
        shutil.rmtree(config_dir, ignore_errors=True)

    # 2. Find install dir (where this module lives)
    install_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    # 3. Find bzcli wrapper
    wrapper_paths = [
        os.path.expanduser('~/.local/bin/bzcli'),
        '/usr/local/bin/bzcli',
        '/usr/bin/bzcli',
    ]

    # 4. Shell startup files are user-owned and are never edited or sourced by
    # the r6 installer, so uninstall must not delete matching user lines.

    # 5. Write background cleanup script (removes install dir + wrapper after process exits)
    fd, cleanup_script = tempfile.mkstemp(prefix='bibzcode-cleanup-', suffix='.sh')
    with os.fdopen(fd, 'w') as f:
        f.write('#!/bin/bash\n')
        f.write('sleep 1\n')
        f.write(f'rm -rf -- {shlex.quote(install_dir)}\n')
        f.writelines(f'rm -f -- {shlex.quote(wp)}\n' for wp in wrapper_paths)
        f.write('rm -f -- "$0"\n')
    os.chmod(cleanup_script, 0o700)

    # 6. Run cleanup script detached
    subprocess.Popen(['bash', cleanup_script],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     stdin=subprocess.DEVNULL)

    print()
    print(' BibzCode CLI has been uninstalled.')
    print(' Run bash install.sh to reinstall anytime.')
    print()

    # The detached script removes itself after deleting the installation.
    sys.exit(0)


def main():
    # Check for install command before parsing (to handle -s flag after install)
    raw_args = sys.argv[1:]
    if len(raw_args) >= 2 and raw_args[0].lower() == 'install':
        # Skip -s flag and pass rest as package
        parts = [p for p in raw_args[1:] if p != '-s']
        package = ' '.join(parts).strip()
        if not package:
            print('Usage: bzcli install <package>', file=sys.stderr)
            print('  or:  bzcli install npx skills add <package>', file=sys.stderr)
            sys.exit(1)
        if package.startswith('npx '):
            cmd = package.split()
            rc, out, err = _run_cmd_with_progress(cmd, ' '.join(cmd))
            if rc == 0:
                print('  \033[32m✓ Skill installed.\033[0m')
                out_text = ''.join(out[-5:]).strip()
                if out_text:
                    for line in out_text.split('\n'):
                        print(f'    {line}')
            else:
                err_text = ''.join(err[-3:]).strip()
                print(f'  \033[31m✗ Error: {err_text[:200] if err_text else "command failed"}\033[0m')
                sys.exit(1)
        else:
            _cmd_install_skill(package)
        return

    # Normal argparse for other commands
    parser = _build_parser()
    args = parser.parse_args()

    # Handle --uninstall-full
    if args.uninstall_full:
        return _cmd_uninstall_full()

    # Handle positional commands
    if args.command:
        cmd0 = args.command[0].lower() if args.command else ''
        cmd1 = args.command[1] if len(args.command) > 1 else ''

        if cmd0 in ('help', '/help', '-h', '--help'):
            parser.print_help()
            return
        if cmd0 == 'logout':
            from .auth import logout
            logout()
            print('Logged out. You will be asked to sign in next time you run bzcli.')
            return
        elif cmd0 == 'list' and cmd1 == 'session':
            return _cmd_list()
        elif cmd0 == 'delete' and cmd1:
            return _cmd_delete(cmd1)
        elif cmd0 == 'list':
            return _cmd_list()
        elif cmd0 == 'uninstall-full' or cmd0 == 'uninstall' or cmd0 == '--uninstall-full':
            return _cmd_uninstall_full()
        else:
            print(f'Unknown command: {" ".join(args.command)}', file=sys.stderr)
            sys.exit(1)

    if args.list:
        return _cmd_list()

    if args.delete:
        return _cmd_delete(args.delete)

    if args.session:
        from .memory import load_session
        memory = load_session(args.session)
        if memory is None:
            print(f'Session {args.session} not found.', file=sys.stderr)
            sys.exit(1)
        print(f'Resuming session: {args.session}')
        session_id = args.session
    else:
        memory = None
        session_id = new_session_id()

    # Enforce account login/registration (Firebase Auth + email verification)
    from .auth import ensure_authenticated
    user = ensure_authenticated()

    # Enforce access permissions (banned/limit checks)
    from .config import enforce_gist
    enforce_gist()

    repl_main(session_id=session_id, memory=memory, user=user)


if __name__ == '__main__':
    main()
