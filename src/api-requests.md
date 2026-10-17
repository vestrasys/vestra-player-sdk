# 实验 API 请求与迁移台账

责任人：API maintainer。`v0.1` 曾是开发草案，没有固定代码修订或完整回归，不能追认为已验收基线。恢复后首次固定的契约为 `probe-0.2`；发布状态、代码指纹和消费者见 [基线登记](baselines/README.md)。新增请求先分类，不通过新增接口绕开实现 bug。

| 请求    | 来源 / 分类          | 决策与理由                                                                                                                                                                  | 兼容性 / 迁移                                                                                                                        | 证明要求                                                                          |
| ------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| API-001 | 六探针 / 能力缺口    | 批准 owner-scoped effects、真实 Rust 媒体任务、外部 RGB/PCM 来源、会话 fencing、插件包校验与试启动。宿主不按插件名分支。                                                    | 对旧播放/高斯/列表接口作兼容扩展；新增消费者使用 `probe-0.2`，不将 `setGaussian` 当新接口模式。                                      | 六探针独立、组合、卸载和真实产物。                                                |
| API-002 | 画面 / 能力缺口      | 批准 `media.start({processing:'current'})` 和公开只读 `effects.list()`，任务启动时复制处理链，验证实际 live chain。效果同 key 更新保持首次注册位置。                        | 新可选字段，不用它的任务行为不变；顺序修复属于实现违反既定插入顺序契约，不能用测试改期望绕过。                                       | 画面真实 worker + PNG 像素、与另一个 owner 的 gblur 组合和卸载。                  |
| API-003 | 字幕、NES / 能力缺口 | 批准 `dialogs.openFile({title,extensions})`，复用原生文件对话框，不能将所有来源硬编码成 MP4。headless FIFO 仅为测试设施。                                                   | `openMedia()` 保留原语义；新增方法不要求旧消费者改动。                                                                               | 字幕/NES 使用真实 worker，取消与正确文件类型。                                    |
| API-004 | 导出 / 能力缺口      | 批准 `dialogs.saveFile({title,extensions,suggestedName})` 和 `includeSubtitles?:boolean`；默认为 true，false 仅影响处理链快照中的 subtitle 资源。                           | 可选字段及新方法；默认有字幕行为保持。现有显式 videoFilter 不被宿主重写成插件专属业务。                                              | 原图/处理后/含与不含字幕 PNG，新的有效 MP4，取消清理。                            |
| API-005 | 连续截图 / 能力缺口  | 批准 `effects.snapshot({includeSubtitles?}) -> {id}`、`releaseSnapshot(id)`、`media.start({processingSnapshot:id})`。句柄属于调用者，内容不可变；任务启动复制后可立即释放。 | 对 API-002 的兼容补充，`processing:'current'` 仍可用；两个模式不能同时指定。导出作者负责迁移“连续任务组”到句柄，单任务消费者不必改。 | 导出中切媒体/修改效果仍绑定开始时源及链；完成、取消、卸载后 jobs/snapshots 清理。 |
| API-006 | NES / 能力缺口       | 批准 `sources.setPaused({key,paused})`；暂停清掉音频队列，恢复重新打开音频流。来源 session 身份、path:null、duration:null 与权威 paused 状态由宿主提供。                    | 新方法；原 RGB/PCM 来源格式不变。NES 作者负责把自身暂停操作同步宿主，不能由 frame 到达频率猜暂停。                                   | 真 ROM 执行/输入、音频实际 pipe 消费、暂停恢复、存档、卸载。                      |

## 被修改或拒绝的方案

- **API-001 的每个效果一个宿主专名方法**：拒绝扩展 `setBrightness/setEQ/setVoice...`。探针在插件侧提供 typed 参数与范围校验，公共后端 escape hatch 使用 FFmpeg filter expression；宿主 argv 启动、真实预验证和资源所有权不省略。此方案是实验后端绑定，不宣称已经跨播放引擎抽象。
- **API-005 的导出插件读取其他 owner 状态并自行重建处理链**：改为宿主持有不可变快照。`effects.list()` 仍是公开诊断接口，但不是正确重建任意未来处理器的通用契约。
- **由 TS mock 媒体能力，或宿主识别具体探针名称**：拒绝。真实 Rust/FFmpeg/Slint 路径与公共来源桥必须保留。

## 已发现的实现回归（修 bug，不追加新 API）

- 效果更新移到链尾：改原位更新，画面组合测试负责顺序证据。
- 字幕 seek 后使用从零计时的 PTS：处理链前恢复绝对媒体时间、输出段末归零；字幕时间区间像素测试负责证据。
- FFplay 9 移除 `-ac`：PCM source 改 `-ch_layout stereo`，不向插件要求特供参数；来源真实音频测试负责证据。
- TS6 指定 entry 与 cwd tsconfig 冲突：验证器使用 `--ignoreConfig`，保留真实 strict TypeScript 编译。
- 导出成功遗留 `.progress`：缓存最终进度后删除旁文件，不改变完成语义。
- Headless ui.patch 只缓存成功：改用 Slint 编译所得 global 属性 schema 验证，和 GUI 边界一致；错误生成包必须真实失败。

## 兼容层责任与退出条件

旧 `file-playback`、`gaussian-blur`、`playlist` 继续可运行；第一方旧文件界面已把 null duration 显示为 0。`setGaussian/gaussianEnabled/sigma` 由 maintainer 维护，仅支持历史实验，高斯实际处理会纳入新快照。删除必须在下一轮破坏性基线中提出，先迁移高斯消费者并执行历史、组合和快照回归；本轮不删除，也不新增此类专名方法。

当前没有已批准但未安排的破坏性迁移，也没有待用户裁决的原则冲突。基线检查尚未完成的项目必须在登记中保留“待验证”，不能用此台账代替运行证据。

## API-007 / probe-0.3 受控破坏性迁移

分类：验收发现 API-005 对外部文件的内容不可变保证无法由“仅复制 filter 字符串”实现；不是使用方 bug。验收复现：同一 snapshot 导出后改写原 SRT，再导出像素变化；停用字幕删除缓存也会使导出缺资源。

比较：解析任意 FFmpeg 表达式推断文件依赖不可控；让导出读取字幕插件文件违反独立性；延迟所有插件缓存清理会泄漏且仍无法防改写。批准显式 `Effect.files` + `{{file:name}}`，Rust owned immutable 副本与共享引用保活，不增加字幕插件名分支。协调者已批准，不涉及既定原则改变或收费服务，无需用户裁决。

影响与责任：

| 消费者                      | 旧基线行为                  | 新基线迁移                                    | 责任                                      |
| --------------------------- | --------------------------- | --------------------------------------------- | ----------------------------------------- |
| subtitle-workbench          | filter 直接指向可变缓存 SRT | filter 占位符 + files 声明，set 后可删原文件  | 原作者；root已作窄迁移，等待作者/验收回归 |
| capture-export 产品         | 使用 snapshot 句柄          | 无 API 用法改变                               | 导出作者回归                              |
| capture-export 集成 fixture | 直接 set 裸路径 subtitle    | 增加 files 与占位符                           | root窄迁移，原像素断言保留                |
| 验收 snapshot fixture       | 直接 set 裸路径 subtitle    | 新公开 usage，保留改写/删除文件后像素不变断言 | 独立验收者                                |
| 其他消费者                  | 无 subtitle 裸路径          | 不修改调用，兼容子集回归                      | maintainer                                |

切换策略：保留 probe-0.2 固定契约与失败证据，发布 probe-0.3 候选；仅暂停依赖 subtitle 裸路径的最终验收。宿主不并存两套不安全语义，不提供会继续破坏不可变保证的临时裸路径兼容层。退出条件：字幕、导出、独立 snapshot 及完整组合回归通过，文档/SDK/宿主一致；下一次新能力请求再另立版本，不继续静默补丁循环。

## 恢复后的契约修复

独立验收增加了 asynchronous disposer drain、sampleRate 整数、caller-owned generated removal、optional 字段类型四组反例。前 3 类已实际运行 contracts + lifecycle 共 6 项通过；边界类型集中 validate_params 和 API-007 正在本候选中回归。停止流程变更修复既定资源释放语义，不要求插件吞错或跳过清理。

### 最终兼容回归发现与修复

全量检查发现旧三消费者在“进行中的动作收到 shutdown”时未退出；没有改旧测试期望。修复为 `closing` 禁止新动作、`transportClosed` 禁止最终关闭后的新请求，两阶段期间 disposer 仍可正常请求清理。在途动作被取消时不再创建新的错误状态 RPC/超时计时器。旧六项协议测试单独回归通过；增加真实旧高斯 worker unload 后后端效果撤销回归，避免只用 mock 证明兼容。

命名空间与值域同样集中修复：headless/GUI load/install 共用 component/global 唯一性检查，替换只排除自己的旧版本；显式 optional 参数类型一律校验；健康 JobState 省略 error 而不是返回 null；空 GUI sourceKind 为 none。它们均是既定契约违约，不通过改基线签名或削弱验收断言处理。

### 探针给出的架构结论（待独立总验收）

1. 命令与界面入口是同一行为的多个入口，不应以“一个插件一个菜单/一个窗口”限制功能；菜单声明仍不是第二套布局框架，界面由原生 Slint 表达。
2. 处理链需要 owner + key、稳定顺序和可撤销生命周期；“最后一个插件设置全局滤镜字符串”无法满足独立卸载。FFmpeg表达式目前是明确的后端 escape hatch，不是已经完成的跨引擎媒体标准。
3. session 身份解决陈旧异步更新，不能代替资源快照；导出任务还需不可变参数与内容引用。资源创建者卸载与资源最后使用者完成不是同一时刻，API-007 用实际反例迫使宿主承担引用生命周期。
4. NES 证明来源不能被限定为有时长、可 seek 的文件。低分辨率 RGB/PCM 桥验证独立来源、输入与时间控制，但不证明大分辨率零拷贝或 GPU 性能。
5. Pi 工坊通过模型调用边界 mock，而真实 agent 循环、编译、试启动、错误修复和回退保留；其存在不要求 Pi 或模型供应商进入 Rust 核心。
6. unload 必须是协议阶段，而非立即 kill 或在宿主线程等待子进程；正常停止 drain 清理 RPC，已确认 fatal 则回收宿主资源并 reap，不能声称异常退出执行过插件 disposer。正常宿主退出的非零状态必须成为测试失败，而不是只看 stdout 成功标记。

这些结论通过六种消费者暴露边界，仍不代表最佳或最终产品架构。生产级播放后端、GPU纹理链、音视频同步、权限/包更新策略和稳定多版本兼容不在本轮验证之内。

## HOST-DIALOG-001：真实原生对话框导致 Slint timer 重入（新一轮验证）

分类：**宿主实现违反非阻塞交互语义，不是插件 API 缺口**。原先 fixture/headless 与程序触发场景没有打开系统文件面板，旧验收不能证明实际原生对话框安全。

实际根因：GUI `Timer` 回调持有 Host 可变借用并同步调用 rfd `pick_file/save_file`；rfd 0.15.4 macOS backend 的同步实现调用 `NSOpenPanel/NSSavePanel.runModal()`，嵌套 AppKit event loop 又触发 Slint DisplayLink timer。Slint 1.18.1 `timers.rs` 的 callback_active 重入断言因此终止进程。

实现修复：公共方法/参数/返回值保持 probe-0.3；宿主登记 native dialog ticket，`slint::spawn_local` 在后续 event-loop poll 内构造 rfd `AsyncFileDialog`，macOS 使用 sheet completion handler，完成后经内部 Incoming 消息匹配原 owner/request ID 回复。Core “添加插件”使用同一异步通道；停止中的 owner 晚到结果丢弃；一次仅允许一个 native panel。第一方不引入 unsafe 或直接 AppKit FFI。

状态：代码已构建，原生 open/save/cancel 与全部真实交互由新一轮独立验收验证中；不使用此前 52/67 的 fixture 结果代替实际系统对话框证据。旧修订和归档不改写。

## API-008 / probe-0.3.1：交互请求等待生命周期澄清

分类：**兼容性生命周期修正**，不是功能缺口或接口签名返工。原统一 30 秒 RPC deadline 不适合系统文件面板；旧文档虽然笼统写 30 秒，但用户仍在选择时插件先失败、随后确认被静默丢弃，是实际交互缺陷。

批准：只对 `dialogs.openMedia/openFile/saveFile` 不设置普通 deadline，等待人类确认/取消；停用 owner 或关闭 transport 继续按统一 shutdown 规则拒绝 pending。其他 RPC 的 30 秒超时不变；不引入新的 dialog SDK、布局描述或插件特判。方法/参数/成功与取消的返回值不变，旧正常消费者无需改代码。

发布策略：保留 0.3 冻结快照，本修订登记 `probe-0.3.1` 候选。SDK 类型相同，运行时/宿主实现及实际交互证据对应新代码修订；不假装多版本协商。测试包含真实 worker 延迟 31.2 秒后回复仍生效、等待用户时停止无遗留（8 项 runtime 测试全过）；此类协议证据不替代实际 Open/Save 停留 35 秒并确认/取消，后者仍待原生验收完成。

## RUNTIME-PLAYBACK-001：等待人类选择时回放大量过期 playback 状态

分类：**runtime 状态投递实现 bug**，不是文件插件自身遗漏同步。root 原生 Open 面板停留约 90 秒后选择文件，实际画面已播放而底栏仍“请选择 MP4 / 0 / 0”；旧 runtime 把每 100ms snapshot 串行排在等待 dialog 的 action 后。

独立可复现的真实 worker 反例：等待 dialog 时注入 100 个完整状态，旧实现结束后逐条呈现 `[1..100]`，而不是当前状态；修复后只呈现 `[100]`。证据 `native-dialog-state-queue-before.log`（失败）与 `...-after.log`（通过）。实现只保留一个等待中的最新 snapshot，动作和业务回调仍原有串行顺序，不将插件回调改为并发。

`onPlayback` 是当前状态观察，不是保证逐 tick 交付的事件日志；本修复避免无界排队和关闭面板后“回放旧进度”，不新增 SDK 方法。原生 35 秒以上停留后画面、进度与文件状态一致仍需 root 实际复测，不能把协议反例测试当作原生通过。
