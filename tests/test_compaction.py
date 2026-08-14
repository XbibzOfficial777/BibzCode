from bibzcode.agent import Agent
from bibzcode.config import cfg
from bibzcode.memory import Memory, load_session, save_session
from bibzcode.toolkit import ToolRegistry


class SummaryProvider:
    supports_tools = False
    default_model = 'unknown-32k-model'
    name = 'summary-test'
    config = {}

    def chat_stream(self, messages, model=None, temperature=None, tools=None, max_tokens=None):
        assert tools is None
        assert 'conversation-memory compressor' in messages[0]['content']
        yield {
            'type': 'content',
            'data': '## User & Preferences\n- User prefers Indonesian.\n\n'
                    '## Facts & Decisions\n- Project is version 7.8.0.\n\n'
                    '## Work Completed\n- Previous tasks completed.\n\n'
                    '## Files & Technical State\n- Source remains available in archive.\n\n'
                    '## Pending\n- Continue the current request.',
        }
        yield {'type': 'done', 'data': None}


def build_history(memory, turns=24):
    for index in range(turns):
        memory.add_user(f'user fact {index}')
        memory.add_assistant(f'assistant answer {index}')


def test_compaction_preserves_lossless_full_history(tmp_path, monkeypatch):
    memory = Memory()
    build_history(memory)
    before = memory.get_full_history()
    registry = ToolRegistry(memory=memory)
    agent = Agent(memory, registry, SummaryProvider(), 'unknown-32k-model', thinking_visible=False)
    monkeypatch.setitem(cfg.config, 'auto_compact', True)
    monkeypatch.setitem(cfg.config, 'auto_compact_message_count', 30)
    monkeypatch.setitem(cfg.config, 'compact_keep_recent', 10)

    result = agent.compact_memory(force=False)

    assert result['compacted'] is True
    assert result['archived_messages'] > 0
    assert memory.conversation_summary.startswith('## User & Preferences')
    assert memory.full_count() == len(before) - 1
    assert memory.get_full_history()[1:] == before[1:]
    assert '[COMPACTED LONG-TERM CONVERSATION MEMORY]' in memory.get_messages()[0]['content']
    assert memory.count() <= 12


def test_session_roundtrip_keeps_archive_summary_and_custom_prompt(tmp_path, monkeypatch):
    import bibzcode.memory as memory_module

    monkeypatch.setattr(memory_module, 'SESSIONS_DIR', str(tmp_path))
    memory = Memory()
    memory._custom_addition = 'Always answer with verified facts.'
    build_history(memory, turns=8)
    cut = memory.compaction_cut_index(keep_recent=8)
    archived = memory.apply_compaction('## Facts & Decisions\n- Durable memory.', cut)
    assert archived > 0

    session_id = 'bzcli-abcdef123456'
    save_session(session_id, memory)
    loaded = load_session(session_id)

    assert loaded is not None
    assert loaded.conversation_summary == memory.conversation_summary
    assert loaded.archived_messages == memory.archived_messages
    assert loaded.get_full_history() == memory.get_full_history()
    assert loaded._custom_addition == 'Always answer with verified facts.'
    assert '[COMPACTED LONG-TERM CONVERSATION MEMORY]' in loaded.get_messages()[0]['content']


def test_compaction_cut_never_orphans_tool_results():
    memory = Memory()
    for index in range(10):
        memory.add_user(f'question {index}')
        memory.add_assistant(f'answer {index}')
    memory.add_user('tool question')
    calls = [
        {'id': f'call-{index}', 'type': 'function',
         'function': {'name': 'calculate', 'arguments': '{"expression":"2+2"}'}}
        for index in range(8)
    ]
    memory.add_assistant_tool_calls('', calls)
    for index in range(8):
        memory.add_tool_result(f'call-{index}', 'calculate', '4')
    memory.add_assistant('The results are 4.')
    # Force the nominal suffix boundary into the tool-result sequence.
    cut = memory.compaction_cut_index(keep_recent=8)
    retained = memory.messages[cut:]
    assert retained[0]['role'] != 'tool'


def test_clear_removes_active_and_archived_memory():
    memory = Memory()
    build_history(memory, turns=8)
    memory.apply_compaction('summary', memory.compaction_cut_index(keep_recent=8))
    memory.clear()
    assert memory.count() == 0
    assert memory.full_count() == 0
    assert memory.archived_messages == []
    assert memory.conversation_summary == ''
