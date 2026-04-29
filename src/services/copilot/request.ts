import { copilotTokenManager } from "~/lib/copilot-token-manager"

export interface FetchCopilotWithRetryOptions {
  url: string
  init: RequestInit
  buildHeaders: () => Record<string, string>
  retryOnStatuses?: Array<number>
}

export const fetchCopilotWithRetry = async (
  options: FetchCopilotWithRetryOptions,
): Promise<Response> => {
  const { url, init, buildHeaders, retryOnStatuses = [401, 403] } = options

  await copilotTokenManager.getToken()

  const response = await fetch(url, {
    ...init,
    headers: buildHeaders(),
  })

  if (retryOnStatuses.includes(response.status)) {
    copilotTokenManager.clear()
    await copilotTokenManager.getToken()

    return await fetch(url, {
      ...init,
      headers: buildHeaders(),
    })
  }

  return response
}
