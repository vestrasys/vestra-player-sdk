# @vestra-player/sdk

Vestra Player 插件 API（`apiVersion: "vestra/1"`）的类型、测试宿主和命令行工具。`1.x` 对应 `vestra/1`，破坏性变更升大版本。

插件运行在播放器里：播放器创建 `plugin` 对象交给插件的 `activate`，插件只 `import type` 本包，构建产物不含 SDK 代码。

## 安装与最小插件

```sh
npm i -D @vestra-player/sdk
```

需要 Node ≥ 22.18（插件的 `.ts` 由 Node 直接去掉类型运行）。

> 过渡期：包还没发布到 npm 时，从 git 标签安装（私有仓库，需要能访问它的 git 凭据）：
> `npm i -D "git+https://github.com/vestrasys/vestra-player-sdk.git#v1.0.0"`。npm 会克隆仓库、安装依赖并运行 `prepare` 生成 `dist/`，得到的内容与 npm 包相同。

本包自带 TypeScript 5.x 和 `@types/node`，`vestra-plugin` 用自带的编译器检查和构建，不受项目里其它 TypeScript 版本影响。

```text
my-plugin/
  manifest.json        {"id":"me.hello","version":"1.0.0","apiVersion":"vestra/1","entry":"main.ts","capabilities":["commands","ui.osd"]}
  main.ts
  tests/main.test.ts
  package.json         {"type":"module","scripts":{"check":"vestra-plugin check","build":"vestra-plugin build","test":"vestra-plugin test"}}
```

```ts
// main.ts
import type { Plugin } from "@vestra-player/sdk";

export default async function activate(plugin: Plugin) {
  plugin.commands.add({ id: "hello", title: "Hello", run: () => plugin.osd.show("Hello") });
}
```

```ts
// tests/main.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin } from "@vestra-player/sdk/testing";
import activate from "../main.ts";

test("hello", async () => {
  const { host, stop } = await startPlugin(activate, { directory: new URL("..", import.meta.url) });
  await host.command("hello").run();
  assert.deepEqual(host.osd, ["Hello"]);
  await stop();
});
```

## 入口

| 入口 | 内容 | 谁用 |
| --- | --- | --- |
| `@vestra-player/sdk` | 插件 API 类型（`Plugin`、`Window`、`Command`…），只有类型 | 插件，`import type` |
| `@vestra-player/sdk/testing` | `TestHost`、`startPlugin`、`HostError`：内存里的假宿主，走真实协议 | 插件测试 |
| `@vestra-player/sdk/runtime` | `createPlugin` 等实现入口 | **仅供播放器内部**（插件运行器），不属于插件 API，不受语义化版本约束 |

其它路径（`wire` 协议等内部模块）不在 `exports` 里，不能引用。

## 命令行 `vestra-plugin`

```text
vestra-plugin <check|build|test|pack> [插件目录...] [--version x.y.z] [--out 目录]
```

- `check`：严格类型检查插件的 `.ts` 与 `tests/*.ts`。沿用插件目录或上层最近的 `tsconfig.json`（到仓库根为止），没有就用内置的严格设置。
- `build`：检查后写 `dist/`：`.ts` 去掉类型成 `.js`，其它文件照抄，`dist/manifest.json` 写入版本。产物里出现对本包的运行时引用会报错。
- `test`：`node --test tests/*.test.{ts,mjs}`。
- `pack`：构建后把 `dist/` 打成 `<id>-<version>.zip`，输出大小和 sha256。

插件目录默认是当前目录；需要 Node ≥ 22.18。`package.json` 的 `"vestra"` 字段：`{"bundle": true | {"external": [...]}, "assets": ["vendor"]}`（`bundle` 用插件自己的 esbuild 打包入口）。

## Slint 控件库副本

`slint/vestra/theme.slint`、`slint/vestra/widgets.slint`（及它们引用的 `slint/palette.slint`）是播放器 `@vestra/` 库的**只读副本**，只用于在编辑器里编译和预览插件界面。运行时由播放器提供正式版本，以播放器为准，不要修改副本。

编辑器（Slint LSP）里把库路径 `vestra` 指到 `node_modules/@vestra-player/sdk/slint/vestra`，就能解析 `import { Button } from "@vestra/widgets.slint";`。

## 发布格式

包里是编译后的 `.js` 与 `.d.ts`（`dist/`），不是 `.ts` 源码：Node 不对 `node_modules` 里的文件做类型剥离，打包器、旧版 TypeScript、编辑器也都直接读 `.js` + `.d.ts`。

## 版本

| 包版本 | 插件 `apiVersion` | 说明 |
| --- | --- | --- |
| `1.x` | `vestra/1` | 当前版本。小版本只做向后兼容的新增 |

插件 API 有破坏性变更时，播放器改用新的 `apiVersion`，本包同时升大版本。`./runtime` 入口只给播放器用，不受语义化版本约束：播放器锁定确切的版本。

## 开发本仓库

```sh
npm ci              # 安装依赖，prepare 生成 dist/
npm run check       # 类型检查 src/ 与 test/
npm run format:check
npm run build       # 重建 dist/
npm test            # 单元测试（直接跑 src/）
npm pack --dry-run  # 查看包内容：README.md、package.json、bin/、dist/、slint/
```

- **Slint 副本的源头是播放器**（`vestra-player` 仓库的 `src/host/ui/palette.slint`、`src/host/ui/vestra/`）。播放器改了控件库，要把同样的文件复制到这里的 `slint/` 并发版；播放器那边的一致性测试会检查已安装的 SDK 副本与宿主逐字节相同。
- 能力表、`API_VERSION`、命令上限（`src/capabilities.ts`、`src/plugin/testing.ts`）也要和宿主一致，同样由播放器的测试检查。
- **发版**：改 `package.json` 的 `version`，提交后打标签 `v<version>` 并推送。`publish.yml` 在标签推送时检查、测试并 `npm publish --access public`，需要仓库 secret `NPM_TOKEN`（缺失时工作流直接失败）。标签必须与 `version` 一致。
- 播放器随后把依赖升到新版本（`npm install @vestra-player/sdk@<version>`），跑全量检查。
