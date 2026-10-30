import { useQuery } from "@tanstack/react-query";
import { useSessionState } from "./session-state";
import { useState, type FormEvent } from "react";
import type {
  PlanningProviderView,
  SkillView,
  SkillInput,
  ToolView,
} from "@tuyile/contracts";
import {
  Button,
  Field,
  ChoiceField,
  Checkbox,
  Input,
  Notice,
  Tag,
  useConfirm,
} from "@tuyile/ui";
import { client } from "./api";
export function ExtensionsAdmin({
  csrfToken,
  hidePlanning = false,
}: {
  csrfToken: string;
  hidePlanning?: boolean;
}) {
  const [mode, setMode] = useState("openai"),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [formKey, setFormKey] = useState(0);
  const [draft, setDraft] = useState<Partial<SkillInput>>({ version: 1 }),
    [selected, setSelected] = useState<string[]>(["image.generate@1"]);
  const confirm = useConfirm();
  const request = client(csrfToken);
  const state = useSessionState();
  const providerQuery = useQuery({
    queryKey: state.key("planning-providers"),
    queryFn: ({ signal }) =>
      request<{ providers: PlanningProviderView[] }>(
        "/image-admin/planning-providers",
        undefined,
        signal,
      ),
  });
  const skillQuery = useQuery({
    queryKey: state.key("admin-skills"),
    queryFn: ({ signal }) =>
      request<{ skills: SkillView[] }>(
        "/image-admin/skills",
        undefined,
        signal,
      ),
  });
  const toolQuery = useQuery({
    queryKey: state.key("admin-tools"),
    queryFn: ({ signal }) =>
      request<{ tools: ToolView[] }>("/image-admin/tools", undefined, signal),
  });
  const providers = providerQuery.data?.providers ?? [],
    skills = skillQuery.data?.skills ?? [],
    tools = toolQuery.data?.tools ?? [];
  async function refresh() {
    await Promise.all([
      providerQuery.refetch({ throwOnError: true }),
      skillQuery.refetch({ throwOnError: true }),
      toolQuery.refetch({ throwOnError: true }),
      state.queries.invalidateQueries({ queryKey: state.key("skills") }),
    ]);
  }
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      await refresh();
      setMessage("已保存配置版本。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function planning(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run(async () => {
      await request("/image-admin/planning-providers", {
        mode,
        baseUrl: mode === "fake" ? "" : f.get("baseUrl"),
        model: f.get("model"),
        apiKey: f.get("apiKey") || undefined,
        preserveKey: f.get("preserveKey") === "on",
        supportsImages: mode === "fake" || f.get("supportsImages") === "on",
        responseMode: f.get("responseMode"),
        maxOutputTokens: Number(f.get("maxOutputTokens")),
        maxInputCharacters: Number(f.get("maxInputCharacters")),
      });
      setFormKey((k) => k + 1);
    });
  }
  function skill(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run(async () => {
      await request("/image-admin/skills", {
        key: f.get("key"),
        version: Number(f.get("version")),
        name: f.get("name"),
        description: f.get("description"),
        instructions: f.get("instructions"),
        scenarios: String(f.get("scenarios") ?? "")
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        requiredInputs:
          f.get("references") === "on"
            ? ["prompt", "referenceImages"]
            : ["prompt"],
        tools: selected.map((value) => {
          const [id, version] = value.split("@");
          return { id, version: Number(version) };
        }),
        enabled: true,
      });
      setDraft({ version: 1 });
      setSelected(["image.generate@1"]);
      setFormKey((k) => k + 1);
    });
  }
  return (
    <>
      {(error ||
        providerQuery.error ||
        skillQuery.error ||
        toolQuery.error) && (
        <Notice error>
          {error ||
            providerQuery.error?.message ||
            skillQuery.error?.message ||
            toolQuery.error?.message}
        </Notice>
      )}
      {message && <Notice>{message}</Notice>}
      {!hidePlanning && (
        <>
          <section className="settings-section">
            <h2>规划服务</h2>
            <p className="hint">
              规划与图片服务分别保存。保存配置不发起模型调用；每类只有一个当前版本。
            </p>
            <form
              key={`planning-${formKey}`}
              onSubmit={planning}
              aria-label="保存规划服务"
            >
              <ChoiceField
                label="规划服务类型"
                value={mode}
                onValueChange={setMode}
                options={[
                  { value: "openai", label: "OpenAI 兼容 Chat Completions" },
                  { value: "fake", label: "本地测试规划（不调用真实模型）" },
                ]}
              />
              {mode === "openai" && (
                <>
                  <Field
                    label="规划服务地址"
                    name="baseUrl"
                    type="url"
                    required
                    placeholder="https://api.openai.com/v1"
                  />
                  <Field
                    label="规划 API Key"
                    name="apiKey"
                    type="password"
                    autoComplete="new-password"
                  />
                  <Checkbox name="supportsImages">
                    规划模型支持参考图视觉输入
                  </Checkbox>
                  <Checkbox name="preserveKey">
                    显式沿用当前规划 Key（仅同地址）
                  </Checkbox>
                </>
              )}
              <Field
                label="规划模型 ID"
                name="model"
                required
                placeholder={mode === "fake" ? "test-planner" : "模型 ID"}
              />
              <ChoiceField
                label="结构化输出模式"
                name="responseMode"
                options={[
                  { value: "json_object", label: "JSON 模式" },
                  { value: "text", label: "文本输出后由服务端校验" },
                ]}
              />
              <Field
                label="单次规划总输出 token 预算"
                name="maxOutputTokens"
                type="number"
                min={256}
                max={8192}
                defaultValue={4096}
                required
              />
              <Field
                label="规划输入字符上限"
                name="maxInputCharacters"
                type="number"
                min={1000}
                max={64000}
                defaultValue={32000}
                required
              />
              <Button disabled={busy} className="primary">
                保存规划服务
              </Button>
            </form>
            <ul className="provider-versions">
              {providers.map((p) => (
                <li key={p.id}>
                  <div>
                    <strong>{p.model}</strong>{" "}
                    <Tag>
                      {p.revoked
                        ? "已撤销"
                        : p.active
                          ? "当前版本"
                          : "历史版本"}
                    </Tag>
                    <p className="hint">
                      {p.mode === "fake" ? "本地测试" : p.baseUrl} · 输出预算{" "}
                      {p.maxOutputTokens} ·{" "}
                      {p.supportsImages ? "支持参考图" : "仅文本"}
                    </p>
                  </div>
                  <Button
                    type="button"
                    disabled={busy || p.revoked}
                    onClick={() =>
                      void (async () => {
                        if (
                          await confirm(
                            "紧急撤销此规划配置？已开始的调用只能尽力取消，后续调用将停止。",
                          )
                        )
                          await run(() =>
                            request(
                              `/image-admin/planning-providers/${p.id}/revoke`,
                              {},
                            ),
                          );
                      })()
                    }
                  >
                    紧急停用
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      <section className="settings-section">
        <h2>创作技能</h2>
        <p className="hint">
          技能提供创作指导，不改变权限、计次或确认规则。每次修改新增版本；普通停用只阻止新计划使用，紧急撤销会阻止后续执行。
        </p>
        <form
          key={`skill-${formKey}`}
          onSubmit={skill}
          aria-label="保存技能版本"
        >
          <Field
            label="技能标识"
            name="key"
            defaultValue={draft.key}
            required
            pattern="[a-z][a-z0-9.-]{1,79}"
            placeholder="product-photo"
          />
          <Field
            label="技能版本"
            name="version"
            type="number"
            min={1}
            defaultValue={draft.version ?? 1}
            required
          />
          <Field
            label="技能名称"
            name="name"
            defaultValue={draft.name}
            maxLength={80}
            required
          />
          <Field
            label="技能说明"
            name="description"
            defaultValue={draft.description}
            maxLength={500}
            required
          />
          <label className="field">
            <span>创作指导</span>
            <Input.TextArea
              name="instructions"
              defaultValue={draft.instructions}
              rows={5}
              maxLength={12000}
              required
            />
          </label>
          <label className="field">
            <span>适用场景（每行一项）</span>
            <Input.TextArea
              name="scenarios"
              defaultValue={draft.scenarios?.join("\n")}
              rows={2}
            />
          </label>
          <Checkbox
            name="references"
            defaultChecked={draft.requiredInputs?.includes("referenceImages")}
          >
            使用此技能必须提供参考图
          </Checkbox>
          <div className="field">
            <span>依赖的可信工具版本</span>
            <Checkbox.Group
              value={selected}
              onChange={(v) => setSelected(v.map(String))}
              options={tools.map((t) => ({
                label: `${t.name} v${t.version}${!t.enabled || t.revoked ? "（不可用）" : ""}`,
                value: `${t.id}@${t.version}`,
                disabled: !t.enabled || t.revoked,
              }))}
            />
          </div>
          <Button disabled={busy || !selected.length} className="primary">
            保存并启用新技能版本
          </Button>
        </form>
        <ul className="provider-versions">
          {skills.map((s) => (
            <li key={s.id}>
              <div>
                <strong>
                  {s.name} v{s.version}
                </strong>{" "}
                <Tag>
                  {s.revoked ? "已撤销" : s.enabled ? "可用于新计划" : "已停用"}
                </Tag>
                <p>{s.description}</p>
              </div>
              <div className="actions">
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setDraft({
                      ...s,
                      version:
                        Math.max(
                          ...skills
                            .filter((x) => x.key === s.key)
                            .map((x) => x.version),
                        ) + 1,
                    });
                    setSelected(s.tools.map((t) => `${t.id}@${t.version}`));
                    setFormKey((k) => k + 1);
                  }}
                >
                  派生新版本
                </Button>
                <Button
                  type="button"
                  disabled={busy || s.revoked}
                  onClick={() =>
                    void run(() =>
                      request(`/image-admin/skills/${s.id}/state`, {
                        enabled: !s.enabled,
                        revoked: false,
                      }),
                    )
                  }
                >
                  {s.enabled ? "普通停用" : "启用"}
                </Button>
                <Button
                  type="button"
                  disabled={busy || s.revoked}
                  onClick={() =>
                    void (async () => {
                      if (
                        await confirm(
                          "紧急撤销此技能版本？后续尚未发出的调用将停止。",
                        )
                      )
                        await run(() =>
                          request(`/image-admin/skills/${s.id}/state`, {
                            enabled: false,
                            revoked: true,
                          }),
                        );
                    })()
                  }
                >
                  紧急撤销
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="settings-section">
        <h2>可信工具</h2>
        <p className="hint">
          工具由部署代码注册，管理端不接收可执行代码。每个工具调用最多生成一张图片，并复用统一授权和结算。
        </p>
        <ul className="provider-versions">
          {tools.map((t) => (
            <li key={`${t.id}@${t.version}`}>
              <div>
                <strong>
                  {t.name} v{t.version}
                </strong>{" "}
                <Tag>
                  {t.revoked ? "已撤销" : t.enabled ? "可用于新计划" : "已停用"}
                </Tag>
                <p className="hint">
                  {t.id} · 参考图 {t.minReferences}–{t.maxReferences} 张
                </p>
              </div>
              <div className="actions">
                <Button
                  type="button"
                  disabled={busy || t.revoked}
                  onClick={() =>
                    void run(() =>
                      request(`/image-admin/tools/${t.id}/${t.version}/state`, {
                        enabled: !t.enabled,
                        revoked: false,
                      }),
                    )
                  }
                >
                  {t.enabled ? "普通停用" : "启用"}
                </Button>
                <Button
                  type="button"
                  disabled={busy || t.revoked}
                  onClick={() =>
                    void (async () => {
                      if (
                        await confirm(
                          "紧急撤销此工具版本？绑定它的后续调用将停止。",
                        )
                      )
                        await run(() =>
                          request(
                            `/image-admin/tools/${t.id}/${t.version}/state`,
                            { enabled: false, revoked: true },
                          ),
                        );
                    })()
                  }
                >
                  紧急撤销
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
