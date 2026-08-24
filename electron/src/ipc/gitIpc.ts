// the git:* surface, backing the Source Control panel
import * as gitService from '../gitService';
import { handleFs } from './ipcResult';

export function registerGitIpc(): void {
	handleFs('git:status', gitService.gitStatus);
	handleFs('git:show', gitService.gitShowHead);
	handleFs('git:init', gitService.gitInit);
	handleFs('git:stage', gitService.gitStage);
	handleFs('git:unstage', gitService.gitUnstage);
	handleFs('git:discard', gitService.gitDiscard);
	handleFs('git:commit', gitService.gitCommit);
	handleFs('git:userName', gitService.gitUserName);
}
