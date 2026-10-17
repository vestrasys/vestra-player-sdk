# 实验公共契约 probe-0.3

本契约仅为六探针实验，不是最终产品 API。首次固定契约、代码指纹和消费者目标见 [基线登记](baselines/README.md)。Rust 拥有公共状态与真实媒体任务；TS 插件拥有业务策略。插件不能导入宿主内部或其他插件。

## 接入

`activate(ctx: PluginContext): Promise<void | (() => void | Promise<void>)>`。原生 Slint 仍使用 manifest.ui，global 提供 `action(string,float)`；ui.patch 更新此插件 global 的原始值。manifest 可增加 `commands: [{id,title,menu:string[]}]`，命令派发到同名 onAction，不另造按钮/布局 DSL。菜单可以跨多个顶级路径。

所有新增方法在 ctx 下：

```ts
await ctx.capabilities(); // string[]
const state = await ctx.player.snapshot(); // sessionId:string; duration:number|null
await ctx.effects.set({
  key: "grade",
  kind: "video",
  filter: "eq=brightness=0.1:contrast=1.2",
  sessionId: state.sessionId,
});
await ctx.effects.remove("grade");
const job = await ctx.media.start({
  input: "/absolute/source.mp4",
  output: "/absolute/result.mp4",
  videoFilter: "eq=contrast=1.2",
  audioFilter: "volume=0.8",
  start: 0,
  duration: 2,
  format: "clip",
});
await ctx.media.status(job.id); // {id,state:'running'|'succeeded'|'failed'|'cancelled',error?:string}
await ctx.media.cancel(job.id);
await ctx.sources.open({
  key: "nes",
  width: 256,
  height: 240,
  sampleRate: 44100,
}); // {sessionId}
await ctx.sources.present({
  key: "nes",
  sessionId,
  rgb: Buffer.from(rgb).toString("base64"),
  pcm: Buffer.from(s16le).toString("base64"),
});
await ctx.sources.close("nes");
await ctx.plugins.validate("/absolute/candidate/manifest.json"); // {valid:boolean,diagnostics:string[]}
await ctx.plugins.install("/absolute/candidate/manifest.json"); // {id:string}; transaction preserves previous version on failure
await ctx.plugins.remove("generated-id");
```

`effects.kind` is `'video'|'audio'|'subtitle'` (subtitle accepts FFmpeg subtitle filter). Filters are trusted FFmpeg filter expressions, never shell fragments; host constructs argument arrays. Only own key can be replaced/removed. Multiple owners compose in deterministic insertion order; unloading removes only own resources. `sessionId` required for subtitle effects; optional for persistent video/audio defaults; mismatch rejects before mutation.

`media.format` is `'clip'|'image'|'audio'`; optional videoFilter/audioFilter are task snapshots, never global lookup after task creation; image uses one frame. Job source is an absolute path snapshot, unaffected by playback switches. Job IDs owner scoped; cancellation kills/reaps child, removes partial output. Host refuses output overwrite. Long work is polled, RPC dispatch stays responsive.

`sources` represents externally produced realtime media; raw RGB24 exact width*height*3, optional signed interleaved stereo PCM16LE. No fake video duration/seek is required. Input uses `ctx.onInput(handler)` with `{key,pressed}`; tests may inject via host test control. Host rejects stale sessions, ownership mismatch, malformed frames. Source playback pauses by stopping presentation; game/emulator timing belongs to source plugin.

`plugins.validate` performs manifest, TypeScript and Slint compilation; diagnostics are real compiler messages. Install validates before replacing/starting; remove only installed generated plugin, not arbitrary host paths. Plugins are trusted local code, this is not a security sandbox.

## Errors / serialization / lifecycle

JSON finite numbers and primitive UiProperties only. Errors reject Promise with readable diagnostic (no result masquerading as success). Host resource ownership comes from authenticated child process identity, never caller supplied owner. Shutdown stops owned jobs, effects, source and commands. IDs and manifest components/globals unique. RPC timeout is 30s; long tasks return handles immediately.

Existing setGaussian is a legacy compatibility path, not pattern for new effects. PlaybackState adds sessionId, sourceKind:'file'|'external'|'none', duration nullable. Old file experiments can treat absent/null duration as zero.

## Test surface

Rust `--headless` reads JSON lines `{id,method,params}`, replies `{id,result}` / `{id,error}`. This is an explicit development harness, not production authenticated IPC. The shared TS client spawns it and real plugin workers; integration tests do not substitute media algorithms. `--check-ui [manifest...]` validates supplied Slint compositions, default scans all plugins.


## 增量能力与精确语义

- `dialogs.openFile({title,extensions})`、`saveFile({title,extensions,suggestedName})` 返回绝对路径或 null；取消不代表错误。GUI 使用原生对话框，headless `host.dialogs` 只注入测试选项。
- `effects.snapshot({includeSubtitles?:boolean})` 返回 owner-scoped、不可变的 `{id}`；`media.start({processingSnapshot:id,...})` 复制快照，随后即可 `releaseSnapshot(id)`。同一任务不能同时指定 snapshot 和 `processing:'current'`。
- `processing:'current'` 在每个任务开始时读取当前链；连续任务组应共享一个 snapshot，避免之后的媒体切换、效果变更影响任务组。
- 任务以独立工作文件运行，成功后无覆盖地发布到目标路径；失败/取消删除工作文件、错误与进度旁文件。`media.status` 包含 `progressSeconds`（实际 FFmpeg 输出时间，不冒充百分比）。任务取消幂等，卸载取消且移除调用者所有任务与快照。
- `sources.setPaused({key,paused})` 更新权威暂停状态；插件停止/恢复自己的模拟时钟。暂停清空真实音频队列，后续恢复时重建 PCM consumer。
- source PCM 是 stereo signed PCM16LE，采样率 8k–192k，单次不超过 200ms。RGB 与 PCM 全部验证、音频有界入队成功后才提交该帧；背压拒绝不能悄悄提交 RGB。写音频在有界 worker 中，不阻塞 GUI。
- `capabilities()` 包含 `api.probe-0.3`；`effects.subtitle` 由当前 FFmpeg 是否含 libass subtitles filter 决定，不虚报可用。
- 此版本没有运行时多版本协商。新六探针目标均为同一 `probe-0.3`，旧三消费者使用明确保留的兼容子集。不能因为版本字符串相似就声称任意历史插件兼容。
- `ui.patch` 只支持 string/number/boolean，属性必须存在且符合插件 Slint global 的实际编译类型；headless 也执行同样校验。安装插件和重组 GUI 不是权限沙箱。

完整类型以同目录 `types.ts` 为准；[变更台账](api-requests.md) 记录每个能力的来源、决策和迁移。首次基线快照发布后不改写，后续兼容扩展使用新版本；纯契约违约修复须记录新代码修订与消费者回归。


## probe-0.3：受管文件的显式迁移（API-007）

`Effect.files?: Record<string,string>` 将资源名映射到绝对路径，filter 使用 `{{file:name}}` 占位符。例如：

```ts
await ctx.effects.set({
  key: "captions",
  kind: "subtitle",
  sessionId: state.sessionId,
  filter: "subtitles=filename={{file:captions}}:force_style='FontSize=24'",
  files: { captions: absoluteSrtPath },
});
```

set 成功前宿主复制文件并验证展开后的真实过滤器。成功后插件可删除或改写原文件；effect、snapshot、job 各持有引用，最后一个引用释放后删除宿主副本。验证失败时本次临时文件回收，原效果保留。取消、完成、停用各释放自己的引用；一个插件停用不能破坏另一个 owner 已启动的导出。

这是 **subtitle 裸路径的破坏性迁移**：`kind:'subtitle'` 必须声明 files 并使用占位符；不再悄悄接受可变的外部字幕路径。其他 kind 的外部文件依赖同样必须显式声明；不解析任意 FFmpeg 表达式推断文件依赖。未经声明的外部资源不在 immutable 保证内。单文件上限 64MiB，每效果最多 16 个文件。模板变量仅接受 ASCII 字母数字、下划线、连字符。

固定的 probe-0.2 快照保留，已证实它的字幕外部文件快照不满足不可变保证，不能继续宣称该版本通过。probe-0.3 仅迁移字幕产品消费者及两个直接设置字幕的测试 fixture；画面、音频、导出产品、NES、工坊 API 用法不变，继续回归兼容子集。宿主仅运行当前一个基线，不声称协商运行两个版本。

卸载使用两阶段 drain：先收回 owned 宿主资源，再允许停止中的 worker 完成清理 RPC，收到 stopped 后回收进程；两秒超时返回 disposal 错误并强制回收。UI 关闭与 headless EOF 同样执行有界 drain。
