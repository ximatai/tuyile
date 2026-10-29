import type { ErrorResponse } from "@tuyile/contracts";
const messages: Record<string, string> = {
  CANVAS_CONFLICT: "画布已在其他页面修改。本地内容已保留，请重新加载或另存副本。",
  MODEL_CAPABILITY_UNSUPPORTED:
    "此模型不支持当前尺寸、格式、质量或参考图，请调整参数。",
  TOOL_UNAVAILABLE: "所需工具已停用或撤销，不能提交新的创作。",
  TOOL_VERSION_UNAVAILABLE: "部署中没有所需工具版本，请联系管理员。",
  SKILL_VERSION_CONFLICT: "这个技能版本已存在，请使用新版本号。",
  SKILL_UNAVAILABLE: "这个技能版本不可用，请重新选择。",
  INVALID_MODEL_CAPABILITIES: "每个模型需有且仅有一份能力声明。",
  PLANNING_PROVIDER_NOT_CONFIGURED: "尚未配置可用规划服务。",
  SPEC_LIMIT: "图片规格超出当前限制，请调整尺寸、张数或质量。",
  MODEL_NOT_ALLOWED: "当前账号不能使用这个模型。",
  QUEUE_FULL: "排队已满，请稍后重试。",
  SUBMISSION_RATE: "提交过于频繁，请稍后重试。",
  IMAGE_QUOTA: "图片额度不足，整单未提交。",
  STORAGE_QUOTA: "存储空间不足，请先清理不再引用的图片。",
  PROVIDER_NOT_CONFIGURED: "尚未配置可用图片服务。",
  IDEMPOTENCY_CONFLICT: "同一提交标识对应了不同内容，请先核对历史任务。",
  REFERENCE_UNAVAILABLE: "参考图已不可用，请重新选择。",
  ASSET_REFERENCED: "图片仍被任务引用，暂不能删除。",
  INVALID_IMAGE: "图片格式、大小或解码检查未通过。",
  DISK_LOW: "服务器可用磁盘空间不足，暂停新任务。",
  API_KEY_REQUIRED: "请提供 Key，或显式选择沿用当前服务的 Key。",
  INVALID_PROVIDER_URL: "服务地址必须是 HTTPS 地址，且不含凭据、查询和片段。",
  FAKE_PROVIDER_DISABLED: "正式环境不允许测试模型。",
  RESOLUTION_CONFLICT: "此任务已按其他结果核验，请刷新后检查。",
  INVALID_RESOLUTION: "核验数量或任务状态不正确。",

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
        window.dispatchEvent(new Event("tuyile-unauthenticated"));
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
