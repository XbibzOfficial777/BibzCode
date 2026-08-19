import { injectable, inject } from '@theia/core/shared/inversify';
import {
    Command,
    CommandContribution,
    CommandRegistry,
    MenuContribution,
    MenuModelRegistry,
    MAIN_MENU_BAR
} from '@theia/core/lib/common';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { MessageService } from '@theia/core/lib/common/message-service';

const BIBZCODE_COMMAND: Command = {
    id: 'bibzcode.open-command-center',
    label: 'BibzCode: Open Command Center'
};

const BIBZCODE_ABOUT_COMMAND: Command = {
    id: 'bibzcode.show-platform-info',
    label: 'BibzCode: Platform & Extension Compatibility'
};

@injectable()
export class BibzcodeIdeContribution implements CommandContribution, MenuContribution, KeybindingContribution {
    @inject(MessageService)
    protected readonly messageService!: MessageService;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(BIBZCODE_COMMAND, {
            execute: () => this.messageService.info(
                'BibzCode Command Center is ready. Use F1 to access Theia commands, VS Code extensions, tasks, debug, search, and workspace tools.'
            )
        });
        commands.registerCommand(BIBZCODE_ABOUT_COMMAND, {
            execute: () => this.messageService.info(
                'BibzCode IDE is built on Eclipse Theia. VS Code extensions are loaded through the compatible extension host and Open VSX registry; Theia extensions add product-level capabilities.'
            )
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        const bibzcodeMenu = [...MAIN_MENU_BAR, 'bibzcode'];
        menus.registerSubmenu(bibzcodeMenu, 'BibzCode');
        menus.registerMenuAction(bibzcodeMenu, {
            commandId: BIBZCODE_COMMAND.id,
            label: BIBZCODE_COMMAND.label
        });
        menus.registerMenuAction(bibzcodeMenu, {
            commandId: BIBZCODE_ABOUT_COMMAND.id,
            label: BIBZCODE_ABOUT_COMMAND.label
        });
    }

    registerKeybindings(keybindings: KeybindingRegistry): void {
        keybindings.registerKeybinding({
            command: BIBZCODE_COMMAND.id,
            keybinding: 'ctrlcmd+alt+c'
        });
    }
}
