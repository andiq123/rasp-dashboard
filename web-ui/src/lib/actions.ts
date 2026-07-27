/** Human labels for service / ops action toasts. */
export function actionDoneLabel(action: string): string {
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
