# DSH 网页访问

在本机浏览器打开正在运行的 DeepSeek Harness 桌面实例，继续使用同一工作区、会话和任务。

## 从 GitHub 安装

需要使用本机 HTTP 的 Harness Desktop。已在 Windows 上的 `0.2.2-rc.2` 验证。

1. 打开「插件 → 添加插件」，选择 GitHub，输入 `github:wenyio/dsh-web-access#v0.3.0`。如果界面分开填写，仓库为 `wenyio/dsh-web-access`，版本为 `v0.3.0`。
2. 安装并启用「DSH 网页访问」，按提示重启 Harness。

也可退出 Harness 后，用 Desktop 自带的 `dsh` 安装。Windows 上的入口为 `resources/runtime/cli/bin/dsh.cmd`。

```sh
dsh plugin --profile desktop add "github:wenyio/dsh-web-access#v0.3.0"
```

如果已从本地目录安装过同名插件，请先卸载旧安装。

## 使用

- 在插件详情页点「在浏览器打开」，或访问默认地址 [http://127.0.0.1:53197/](http://127.0.0.1:53197/)。
- 「本机自动登录」默认开启，能访问回环端口的程序可直接登录。关闭后，新浏览器需从插件详情页点「在浏览器打开」，已有登录仍有效。
- 修改「网页端口」并保存后，使用详情页显示的新地址。停用插件会关闭网页入口，桌面任务继续运行。

[MIT 许可证](LICENSE) · [问题反馈](https://github.com/wenyio/dsh-web-access/issues)
