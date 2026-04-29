import { html } from "./ui-html"
import { scripts } from "./ui-scripts"
import { styles } from "./ui-styles"

export function getWebUI(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>UniPlug 控制台</title>
<style>${styles}</style>
</head>
<body>
${html}
<script>${scripts}</script>
</body>
</html>`
}
