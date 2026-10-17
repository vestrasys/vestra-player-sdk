# 实验插件开发说明

**本目录仅用于 Slint 可行性实验。接口、协议、运行方式和目录组织均为临时设计，与最终成品 API 会有很大差异，不构成兼容性承诺。**

一个插件由三个部分组成：

- `manifest.json`：插件标识、TS 入口、Slint 组件和导出的全局状态名称。
- `ui.slint`：用 Slint 原有的布局和控件表达界面，不经过自创的 UI 描述协议。
- `index.ts`：导出 `activate(ctx)`，订阅界面动作、调用播放器能力和更新界面属性。

当前试验中 Rust 宿主加载并绘制 `.slint` 文件；TS 逻辑通过单独的 Node 子进程运行。该方式没有使用 `slint-ui` Node GUI 绑定。能否动态组合组件、视频如何呈现、桥接是否值得维护，需要结合宿主实验结果判断。

例如，插件将按钮点击声明为一个 Slint 回调：

```slint
export global ExampleState {
    callback action(string, float);
}

// 放在组件内部；Button 从 std-widgets.slint 导入。
Button {
    text: "暂停 / 播放";
    clicked => { ExampleState.action("toggle-pause", 0); }
}
```

然后用 TS 处理这个动作：

```ts
import type { PluginContext } from "../../sdk/types.ts";

export function activate(ctx: PluginContext) {
  const unsubscribe = ctx.onAction("toggle-pause", () =>
    ctx.player.togglePause(),
  );
  return unsubscribe;
}
```

当前动作参数只支持一个数值，是为了把实验做小；字符串输入、复杂控件模型以及广泛的 Slint 类型绑定不在这个版本内。`ui.patch()` 中的字段必须对应插件导出 global 的原始 Slint 属性名，例如 `is-paused`。

`activate` 可以是异步函数，也可以返回一个清理函数；用户卸载插件时宿主请求运行时执行清理。正常关闭时滤镜插件会撤销自己的高斯滤镜；宿主意外消失时，运行时取消等待中的请求并退出，无法依赖已断开的连接清理后端。

请求执行失败会进入运行时的错误处理并显示到插件 `status` 属性中。高斯插件在后端拒绝配置时读取实际播放状态，避免界面宣称滤镜已成功应用。

Node 版本要求为 `>=22.18`，直接剥离 TS 类型运行，不安装 npm 包。只使用可剥离语法，不使用 enum 和构造参数属性。所有 import 使用 `.ts` 扩展名。

协议标准输出专用于逐行 JSON，插件日志使用标准错误。为避免无限等待，普通宿主请求设有 30 秒超时；文件对话框也遵循该实验限制。测试使用 Node 原生测试框架和实际插件子进程，可在实验目录执行：

```sh
npm test
```

这些测试验证 TS 控制逻辑与协议行为，不代表 Slint 界面、视频输出或真实高斯滤镜已经运行验证。
