import { useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AutoComplete,
  Button,
  Field,
  Modal,
  Input,
  Tooltip,
  useFeedback,
} from "@tuyile/ui";
import { Bookmark } from "lucide-react";
import type { Favorite } from "@tuyile/contracts";
import { client } from "./api";
import { useSessionState, type SessionState } from "./session-state";

export async function refreshPrompts(state: SessionState) {
  await Promise.all(
    [
      "favorites",
      "favorite-groups",
      "prompt-templates",
      "prompt-picker",
      "prompt-shortcuts",
    ].map((key) =>
      state.queries.invalidateQueries({ queryKey: state.key(key) }),
    ),
  );
}
export function PromptFavorite({
  sourceId,
  favoriteId,
  title = "",
  prompt,
  groupName = "",
}: {
  sourceId?: string;
  favoriteId?: string;
  title?: string;
  prompt: string;
  groupName?: string;
}) {
  const state = useSessionState(),
    api = client(state.session.csrfToken),
    feedback = useFeedback();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(title),
    [group, setGroup] = useState("");
  const formId = useId();
  const pending = useRef(false),
    requestId = useRef<string | null>(null);
  const groups = useQuery({
    queryKey: state.key("favorite-groups"),
    queryFn: ({ signal }) =>
      api<{ groups: string[] }>("/library/groups", undefined, signal),
    enabled: open,
  });
  async function save() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      requestId.current ??= crypto.randomUUID();
      await api<Favorite>("/library/favorites", {
        id: requestId.current,
        title: sourceId ? title : name.trim(),
        prompt,
        groupName: sourceId ? groupName : group.trim(),
        ...(sourceId ? { sourcePromptId: sourceId } : {}),
      });
      setOpen(false);
      await refreshPrompts(state);
      feedback.success("已收藏");
    } catch (e) {
      feedback.error((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <Tooltip title={favoriteId ? "已收藏" : "收藏"}>
        <Button
          type="button"
          className="prompt-bookmark"
          aria-label={favoriteId ? "已收藏提示词" : "收藏提示词"}
          disabled={!!favoriteId || !prompt.trim() || busy}
          onClick={() => {
            if (sourceId) void save();
            else {
              setName(title || prompt.trim().split("\n")[0]!.slice(0, 30));
              setGroup("");
              requestId.current = null;
              setOpen(true);
            }
          }}
        >
          <Bookmark size={16} fill={favoriteId ? "currentColor" : "none"} />
        </Button>
      </Tooltip>
      <Modal
        title="收藏提示词"
        open={open}
        onCancel={() => {
          if (!busy) setOpen(false);
        }}
        okText="收藏"
        confirmLoading={busy}
        okButtonProps={{
          disabled: !name.trim() || busy,
          htmlType: "submit",
          form: formId,
        }}
        cancelButtonProps={{ disabled: busy }}
        closable={!busy}
        mask={{ closable: !busy }}
        keyboard={!busy}
      >
        <form
          id={formId}
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void save();
          }}
        >
          <Field
            required
            autoFocus
            label="标题"
            maxLength={100}
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
          <label className="field">
            <span>分组</span>
            <AutoComplete
              placement="topLeft"
              filterOption={(input, option) =>
                String(option?.value ?? "")
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
              value={group}
              options={(groups.data?.groups ?? [])
                .filter(Boolean)
                .map((value) => ({ value }))}
              onChange={setGroup}
              disabled={busy}
            >
              <Input maxLength={60} placeholder="选择或输入分组" />
            </AutoComplete>
          </label>
        </form>
      </Modal>
    </span>
  );
}
