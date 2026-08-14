import sys


def test_tool_registry_does_not_import_selenium_module_on_startup():
    sys.modules.pop('bibzcode.selenium_browser', None)
    from bibzcode.toolkit import ToolRegistry

    registry = ToolRegistry()

    assert 'se_navigate' in registry.tools
    assert 'bibzcode.selenium_browser' not in sys.modules
