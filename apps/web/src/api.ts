import type { ErrorResponse } from "@tuyile/contracts";
const messages: Record<string, string> = {
  INVALID_CREDENTIALS: "账号或密码不正确，或账号暂不可用。",
  UNAUTHENTICATED: "登录已失效，请重新登录。",
  FORBIDDEN: "你没有执行此操作的权限。",
  INVALID_INPUT:
    "请检查输入内容；账号需为 3–64 位小写字母、数字或 . _ -，密码需为 12–128 个字符。",
  INVALID_LINK: "链接已失效、过期或已经使用，请联系管理员重新获取。",
  ALREADY_EXISTS: "这个账号已经存在。",
  CANNOT_DISABLE_SELF: "不能停用当前管理员账号。",
  ACCOUNT_DISABLED: "请先启用账号，再生成链接。",
  NOT_FOUND: "内容不存在或你无权访问。",
  RATE_LIMITED: "操作过于频繁，请在 15 分钟后重试。",
  INVALID_CSRF: "会话已改变，请刷新后重试。",
  INVALID_ORIGIN: "访问来源不匹配，请使用配置的应用地址。",
};
export class ApiError extends Error {
  constructor(
    public code: string,
    public requestId = "",
  ) {
    super(messages[code] ?? "请求未完成，请稍后重试。");
  }
}
export function client(csrfToken = "") {
  return async function request<T>(
    path: string,
    data?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`/api${path}`, {
        method: data === undefined ? "GET" : "POST",
        credentials: "same-origin",
        headers:
          data === undefined
            ? undefined
            : { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: data === undefined ? undefined : JSON.stringify(data),
        signal,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new Error("无法连接服务，请检查网络后重试。");
    }
    if (!response.ok) {
      const body = (await response
        .json()
        .catch(() => null)) as ErrorResponse | null;
      if (
        body?.error.code === "UNAUTHENTICATED" &&
        location.pathname !== "/login" &&
        path !== "/auth/me"
      )
        location.replace("/login");
      throw new ApiError(
        body?.error.code ?? "INTERNAL_ERROR",
        body?.error.requestId,
      );
    }
    return response.json() as Promise<T>;
  };
}

export const sessionTabId = crypto.randomUUID();
export function notifySessionChange() {
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel("tuyile-session");
    channel.postMessage({ sender: sessionTabId });
    channel.close();
  }
}
