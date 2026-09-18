/**
 * 产品名与标识：改名字只改这个文件。
 *
 * package.json 与 README 是静态文本，改名时需手动同步（`grep -rn "Verse" README.md package.json`）。
 */
export const APP_NAME = 'Verse'
export const APP_ID = 'verse-tui-agent'
export const APP_MARK = '✦'
export const APP_TAGLINE = '终端流式 agent'
/** 顶栏左侧文案：`✦ Verse · 终端流式 agent` */
export const HEADER_LABEL = `${APP_MARK} ${APP_NAME} · ${APP_TAGLINE}`
