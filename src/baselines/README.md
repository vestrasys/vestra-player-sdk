# 公共 API 基线登记

## probe-0.2

状态：**历史失败候选，保留证据，未作为已通过基线发布**。字幕外部文件快照反例使本候选未满足自己的不可变保证；后续由 API-007 显式迁移至 probe-0.3。此前 v0.1 是未固定修订的开发草案，不追认为已发布基线。

固定快照：[契约](probe-0.2.contract.md)、[类型](probe-0.2.types.ts.txt)。API-001 至 API-006 归入首次基线。宿主 capability 标识 `api.probe-0.2`；尚未实现多版本协商，本轮所有消费者在同一集成工作树运行。不会给旧插件自动重写 API 调用，也不假装支持独立多版本运行。

| 消费者                | 当前目标                      | 所需能力                                    | 迁移责任 / 状态                                                        |
| --------------------- | ----------------------------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| file-playback         | legacy-experimental1 兼容子集 | playback、openMedia、ui.patch               | maintainer；nullable duration 已映射显示为 0，保留旧命令与播放器方法。 |
| gaussian-blur         | legacy-experimental1 兼容子集 | legacy setGaussian、ui.patch                | maintainer；保留并将效果纳入新处理快照，下一轮破坏性迁移前不得删除。   |
| playlist              | legacy-experimental1 兼容子集 | playback、openMedia、ui.patch               | maintainer；无新能力迁移。                                             |
| video-adjust          | probe-0.2                     | effects.video、menus、ui.patch              | 画面作者；原位更新顺序与 owned cleanup 回归。                          |
| audio-workbench       | probe-0.2                     | effects.audio、media.tasks                  | 音频作者；真实 PCM 回归。                                              |
| subtitle-workbench    | probe-0.2                     | effects.subtitle、sessions、openFile        | 字幕作者；session fencing、绝对时间回归。                              |
| capture-export        | probe-0.2                     | snapshots、media.tasks、saveFile            | 导出作者；API-005 任务组已迁移句柄，最终取消/清理待重新验证。          |
| nes                   | probe-0.2                     | sources.rgb-pcm、input、openFile、setPaused | NES 作者；API-006 暂停和真实 PCM 回归。                                |
| AI 插件工坊（待实现） | probe-0.2                     | plugins.management、真实编译与试启动        | 工坊作者；如有缺口先请求分类，不改其他消费者。                         |

## 验证与修订记录

恢复后先重建当前拆分后的 Rust binary、执行 `tests/contracts.test.ts` 和受影响消费者，再记录代码指纹与运行证据。只执行 typecheck/clippy 不足以声明功能发布。最终版本证据必须与当时实际工作树匹配；新增修复追加记录，不改写已固定快照。

登记当时未执行：新增 contracts、最新全量组合与独立验收。该历史记录不追认为通过；后续实际结果见下方 probe-0.3 正式独立验收。

## probe-0.3

状态：**本轮六插件探针实验验收通过**，不表示生产稳定或成品 API 正式发布。快照：[契约](probe-0.3.contract.md)、[类型](probe-0.3.types.ts.txt)。probe-0.2 的 managed subtitle snapshot 验收失败，旧快照保留，不改写失败为成功。

本轮宿主统一运行 probe-0.3；只有 subtitle-workbench 与直接构建 subtitle 的导出/验收 fixture 迁移目标版本并改变调用。其他消费者保留所用旧目标，在当前宿主执行明确的兼容子集回归，不要求无关插件修改源码。更详细影响、责任与退出条件见 API-007 台账。无运行时多版本协商，也不提供破坏不可变保证的裸路径字幕兼容层。

恢复后已执行：拆分后 Rust build；contracts + 独立 lifecycle 6项通过。API-007及新增边界类型修复后的真实消费者回归已由独立验收完成，详见下方证据；不因此宣称生产正式发布。

### probe-0.3 宿主上的精确消费者矩阵

| 消费者                                                  | 所用契约目标         | 在当前宿主验证的关系                             |
| ------------------------------------------------------- | -------------------- | ------------------------------------------------ |
| file-playback / gaussian-blur / playlist                | legacy-experimental1 | 保留旧用法，不新增专名接口；历史测试回归         |
| video-adjust / audio-workbench / nes / plugin-workshop  | probe-0.2            | 不变调用的兼容子集，不是同时运行另一版宿主       |
| capture-export 产品                                     | probe-0.2            | snapshot公开用法不变，跨owner资产行为在0.3修复   |
| subtitle-workbench                                      | probe-0.3            | 显式API-007 files与placeholder迁移               |
| capture-export / 独立snapshot测试的字幕provider fixture | probe-0.3            | 直接set subtitle者迁移，原像素和生命周期断言保留 |

元数据澄清：冻结的0.3契约文本曾笼统写“全部消费者目标0.3”；本表准确区分代码所用目标与当前单一宿主基线，未改变任何接口、兼容语义或冻结快照。未来破坏性调整仍需逐消费者迁移及回归，不能以本次兼容推断任意旧版本可用。

### 本次代码修订与证据

[源文件指纹清单](probe-0.3.source.json) 固定了 SDK、协议、宿主、检查入口及各消费者的文件哈希；`sourceFingerprint` 为 `2d5b9999b64c002dbb85449e4a2de420f82e43c608ab256976e92d2ac7701f29`。该修订尚未提交，不能把 git HEAD 当作包含这些修改的提交。旧 0.2 候选未保存完整源码指纹，因此仅保留契约/类型及失败复现，不伪造其历史代码修订。

维护者证据位于仓库忽略目录 `.cache/evidence/api-maintainer/`：前一轮完整 `check-final.log` 为 52 项 TS + 1 项真实 Rust 后端 + GUI 通过；其后修复最后的失败 worker 退休路径与宿主非零退出 gate，当前修订的 `final-lifecycle.log` 为 16/16，`final-gui.log` 为真实 67 步窗口场景 exit 0。最终完整独立复跑已通过，见下方正式验收。

源指纹复核方法：读取清单 `sharedFiles` 中每个仓库相对路径，对文件内容执行 SHA-256；按路径排序拼接 `path + NUL + fileSha256 + LF` 后再执行 SHA-256。消费者文件哈希另列，不以某个作者的完成报告代替实际源码。

### 正式独立验收：本轮实验接受

[独立审查报告](../../../doc/probe-review.md) 逐项确认 V/A/S/E/N/W/I/C/G/R；完整 `./src/scripts/check.sh --gui` exit 0，52 项 TypeScript 测试、1 项真实 Rust 后端测试、67 步真实 Slint GUI 场景均通过。独立 TMPDIR 中宿主拥有的临时资源剩余 0；95 个实现文件与实际 binary 在验收前后不变，基线清单 74 个哈希匹配。

可复现归档：[摘要](../../../doc/probe-evidence/2026-10-17/final-summary.json)、[完整命令日志](../../../doc/probe-evidence/2026-10-17/final-check.log)、[独立源码指纹](../../../doc/probe-evidence/2026-10-17/code-fingerprint.json)。本次仅将状态更新为实验接受，没有改实现、源指纹或冻结契约。

仍未声称：最终产品 API、生产级播放/音视频同步、GPU零拷贝、真实 BYOK 服务商互通或物理键鼠/设备全平台支持。probe-0.2 的失败与源修订缺失继续保留，不因新基线通过而改写历史。

## probe-0.3.1：真实原生交互候选

状态：**新增交互验证中，尚未接受**。本修订保留 probe-0.3 方法与类型，显式勘误系统对话框的等待生命周期：三个 dialogs 请求不使用普通 30 秒 deadline，owner/transport 停止仍拒绝 pending；其他 RPC 仍 30 秒。

[冻结契约候选](probe-0.3.1.contract.md)、[相同 SDK 类型快照](probe-0.3.1.types.ts.txt)。所有已有九插件无需修改调用方式；候选验证重点是宿主的异步 AppKit sheet、真实鼠标命中、Open/Save/取消/错误与长驻留，不把旧基线52/67当作本轮完成证据。实现错误 HOST-DIALOG-001、生命周期澄清 API-008 及新交互矩阵分开记录。

旧0.3验收仍只证明当时声明的范围；本轮发现的真实点击故障及后续修复不能回写成“当时已经验证过”。候选的源码指纹与原生交互证据待本轮实现稳定后登记，不复制旧指纹冒充新修订。
