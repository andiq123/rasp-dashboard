/** Human labels for service / ops action toasts. */
export function actionDoneLabel(action: string, status?: string): string {
  if (action === 'redeploy' && status === 'queued') {
    return 'Queued — waiting for build slot'
  }
  switch (action) {
    case 'start':
      return 'Started'
    case 'stop':
      return 'Stopped'
    case 'restart':
      return 'Restarted'
    case 'redeploy':
      return 'Redeploy started'
    default:
      return action
  }
}
