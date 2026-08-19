import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { KeybindingContribution } from '@theia/core/lib/browser/keybinding';
import { BibzcodeIdeContribution } from './bibzcode-ide-contribution';

export default new ContainerModule(bind => {
    bind(BibzcodeIdeContribution).toSelf();
    bind(CommandContribution).toService(BibzcodeIdeContribution);
    bind(MenuContribution).toService(BibzcodeIdeContribution);
    bind(KeybindingContribution).toService(BibzcodeIdeContribution);
});
