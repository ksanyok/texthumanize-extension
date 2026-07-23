# Следы ИИ-конструкторов сайтов и ИИ-медиа (исследование, июль 2026)

Каталог для site-forensics / media-forensics. Собрано агентным
веб-исследованием 2026-07-21 со 107 проверками; `[live]` = проверено curl'ом
на реальном сайте, `UNVERIFIED` = не удалось подтвердить напрямую.
Парная сводка по тексту: [text-signals-2026.md](text-signals-2026.md).

## Часть 1 — поддомены по умолчанию (сильнейший сигнал, у нас НЕ используется)

Наш `collectSite()` собирает `location.hostname`, но site-forensics его не
матчит. Поддомен = ~уверенная идентификация платформы (пока нет кастомного
домена).

### AI-билдеры / vibe-хосты (kind: ai-builder)

| Хост-паттерн | Платформа | Примечание |
|---|---|---|
| `*.lovable.app` | Lovable | + превью `id-preview--{uuid}.lovable.app`; `*.lovableproject.com` (песочницы, истор.) |
| `*.bolt.host` | Bolt.new | |
| `v0-*.vercel.app` | v0 | префикс `v0-` в имени проекта [live]; превью `*.vusercontent.net` |
| `*.replit.app` | Replit | `repl.co` МЁРТВ с 01.01.2024; `*.replit.dev` только при открытом редакторе |
| `*.durable.co` | Durable | встречается `*.durable.site` (противоречие источников) |
| `*.mixo.io` | Mixo | |
| `*.b12sites.com` | B12 | + staging `{name}-staging.b12sites.com` |
| `*.10web.site`, `*.10web.cloud` | 10Web | НЕ 10web.io |
| `*.dora.run` | Dora AI | |
| `*.hostingersite.com` | Hostinger AI | + превью `*.builder-preview.com`; Zyro закрыт, старые `*.zyrosite.com` живы |
| `*.godaddysites.com` | GoDaddy Airo | |
| `*.gamma.site` | Gamma | |
| `*.base44.app` | Base44 (куплен Wix, 2025) | НОВОЕ |
| `*.emergent.host` | Emergent.sh | НОВОЕ |
| `*.unicornplatform.page` | Unicorn Platform | |
| `*.typedream.app` | Typedream | куплен beehiiv, деградирует |

### Классические билдеры (kind: builder)

| Хост-паттерн | Платформа |
|---|---|
| `{user}.wixsite.com/{site}` | Wix free — ПУТЬ, не сабдомен! |
| `{name}.squarespace.com` | Squarespace built-in |
| `*.framer.website` (+ framer.photos/media/wiki) | Framer |
| `*.webflow.io` | Webflow staging |
| `{name}.jimdosite.com`, legacy `*.jimdofree.com` | Jimdo |
| `*.multiscreensite.com` | Duda (НЕ duda.co) |
| `{id}.site123.me` | Site123 |
| `*.carrd.co` | Carrd |
| `*.notion.site` | Notion Sites |
| `*.super.site` | Super.so |
| `{name}.my.canva.site` | Canva Websites |
| `{store}.myshopify.com` | Shopify |

### Generic vibe-хостинг (слабый сигнал, отдельный tier)

`*.vercel.app`, `*.netlify.app`, `*.pages.dev`, `*.workers.dev`,
`*.github.io`, `*.onrender.com`, `*.up.railway.app`, `*.fly.dev`,
`*.surge.sh`, `*.streamlit.app`, `*.hf.space`.
`*.glitch.me` — хостинг закрыт в 2025 (легаси).

## Часть 2 — live-верифицированные код-маркеры (работают и на кастомных доменах)

| Платформа | Маркеры [live] |
|---|---|
| Lovable | `<meta name="author" content="Lovable">`; дефолт `<title>Lovable App</title>`; og:image на `storage.googleapis.com/gpt-engineer-file-uploads/`; `cdn.gpteng.co`; бейдж `<a id="lovable-badge">` + классы `lovable-badge-cta/-close/-text` → `lovable.dev/projects/{uuid}`; `/lovable-uploads/` (unverified) |
| v0 | Next flight `self.__next_f.push`; ссылка `v0.dev/chat/api/open/built-with-v0/`; shadcn-токены; шрифт Geist |
| Framer | `<meta name="generator" content="Framer {hash}">`; `data-framer-name/-component-type/-background-image-wrapper/-page-link-current`; `framerusercontent.com`; бейдж `#__framer-badge-container` / `.__framer-badge` |
| Wix | `<meta name="generator" content="Wix.com Website Builder">`; `static.parastorage.com/services/wix-thunderbolt/`; `window.wixBiSession`. Wix Harmony (агент Aria, 21.01.2026) — та же инфра |
| Squarespace | коммент `<!-- This is Squarespace. -->`; `Static.SQUARESPACE_CONTEXT`; классы `sqs-block*`; `images.squarespace-cdn.com` |
| GoDaddy | `<meta name="generator" content="Starfield Technologies; Go Daddy Website Builder 8.…">`; `img.wsimg.com/isteam|gfonts|blobby/`; виджеты `ux2.*` |
| Webflow | 1-я строка `<!-- Last Published: … -->`; на `<html>`: `data-wf-domain/-page/-site`; `cdn.prod.website-files.com`; классы `w-mod-js`, `w-*`; бейдж `a.w-webflow-badge`; meta generator "Webflow" бывает, но в сэмпле отсутствовал |
| Relume | Webflow-сайт + классы Client-First: `text-size-medium`, `padding-global`, `container-large`, `section_*`, `spacer-*` |
| Notion Sites | `<html class="notion-html" data-notion-html="web" data-notion-version="…">`; `notion_boot_data`; `#notion-app` |
| Super.so | `<meta name="generator" content="Super"/>`; `assets.super.so`; классы `notion-*`; Inter |
| Gamma | классы `card-content`, `card-font-scale`, `grid-padding`, `gamma-moveable-wrapper` |
| Canva | JS-глобал `_canva_website_bootstrap__`; CSS-переменная `--ffsd` в :root |
| Duda | `window.Parameters = {SystemID:'US_DIRECT_PRODUCTION', productId:'DM_DIRECT', …}`; `dmAPI`; класс `dmBody`, префиксы `dm_*` |
| Carrd | одностраничник, ВЕСЬ CSS/JS инлайном; og:image `{site}.carrd.co/assets/images/card.jpg?v={hex}` |
| Shopify | `window.Shopify` (`Shopify.theme`), `ShopifyAnalytics`, `cdn.shopify.com/s/files/`. AI-эвристика 2026: `Shopify.theme.name == "Horizon"` (+9 сиблингов) = дефолт AI Store Builder |
| Elementor | двойной generator: `"WordPress x.y"` + `"Elementor 4.x; features: …"`; классы `elementor-element`, `e-con-*`; `data-elementor-type/-id`; `elementorFrontend` |
| Divi | классы `et_pb_*`; `wp-content/et-cache/`; generator "Divi v4.x" |
| B12 | ассеты `b12.io/client_media/`, `b12.io/prod_traffic/global.js` |
| Unicorn | классы `uni-*`; `unicornplatform.com/static/` |

Бейджи free-тарифов (DOM-детект): Lovable `#lovable-badge`, Framer
`.__framer-badge`, Webflow `.w-webflow-badge`, «Made with Carrd», «Built with
Notion», «Made with Super», «Made with Gamma», «Designed with Canva» (футер),
«Built with v0», «Made with Replit», «Edit with Base44».

Кросс-платформенный vibe-стек (уже частично покрыт HEURISTICS): shadcn-токены
(`bg-background`, `text-foreground`, `text-muted-foreground`, `--radius` в
:root), `data-radix-*`, id `radix-:r0:`, Inter/Geist, Vite `/assets/index-[hash].js`
vs Next `self.__next_f`; дефолт-title «Lovable App», «Vite + React + TS».

## Часть 3 — медиа-маркеры (дельта к нашему media-forensics)

### Чего у нас НЕТ (высокий выигрыш)

1. **Ключи PNG-чанков SD-семейства** (сейчас ловим только слова-сигнатуры):
   - A1111/Forge: tEXt `parameters` со строками `Negative prompt:`, `Steps:`,
     `Sampler:`, `CFG scale:`, `Seed:`, `Model hash:`; в JPEG/WebP та же
     строка в EXIF UserComment
   - ComfyUI: tEXt/iTXt `prompt` + `workflow` (JSON с `class_type`, `KSampler`,
     `CheckpointLoaderSimple`)
   - InvokeAI: `invokeai_metadata` (+legacy `sd-metadata`, `Dream`)
   - Fooocus: `parameters` (JSON-схема fooocus)
   - SwarmUI: `sui_image_params`
   - NovelAI: `Title="AI generated image"`, `Software="NovelAI"` (слово ловим),
     + stealth-LSB в альфа-канале (не читаем — и не обязаны)
2. **Midjourney-2026 профиль** (C2PA НЕТ, но метаданные богатые):
   EXIF ImageDescription / XMP `dc:description` = промпт + `--ar/--v` + Job ID;
   `xmp:CreatorTool="Midjourney"`; IPTC `DigitalImageGUID` = Job UUID;
   имя файла `username_prompt-fragment_{jobId}_{n}.png`
3. **Бакеты разрешений** (слабый сигнал, только в связке):
   SDXL: 1024×1024, 1152×896, 896×1152, 1216×832, 832×1216, 1344×768,
   768×1344, 1536×640, 640×1536; SD1.5: 512×512/768; DALL·E 3: 1024×1024,
   1792×1024, 1024×1792; gpt-image-1: 1024×1024, 1536×1024, 1024×1536
4. **Китайский GB 45438-2025** (обязателен с 01.09.2025): имплицитный
   метадата-лейбл (провайдер + content ID + признак AIGC) у Kling/Jimeng и др.
5. **WebP RIFF-чанк `C2PA`** — проверить, что наш RIFF-парсер его видит
   (ChatGPT отдаёт .webp с 02.2024).

### Состояние C2PA-подписантов (2026)

Подписывают: OpenAI (с 19.05.2026 — Conforming Generator + SynthID во всех
картинках), Adobe Firefly (всегда), Microsoft Designer/Bing, Google (SynthID
всегда, C2PA частично), TikTok (прикрепляет к скачанному AIGC).
НЕ подписывают: Midjourney, Flux, Ideogram, Recraft, Stability-чекпоинты,
Grok (непостоянно).

Соцсети: LinkedIn СОХРАНЯЕТ и показывает «Cr»; TikTok читает и лейблит;
Instagram/Facebook читают, но при раздаче СРЕЗАЮТ; X, Signal — срезают всё;
WhatsApp/Telegram: фото — срезают, «файлом/документом» — сохраняют.
→ «нет меток ≠ человек» особенно после соцсетей — наша honest-note верна.

Невидимые watermarks (SynthID, Stable Signature): клиентски НЕ детектируемы,
только вендорские API. Подтверждено. Наш honest-limit корректен.

### Видео

Sora: C2PA-манифест отдельным box в BMFF (наш BMFF-парсер должен его видеть);
видимый движущийся watermark кроме Pro. Veo 3: SynthID всегда, бейдж «Veo»
у не-Ultra. Runway: watermark на free. Kling: GB-лейбл + лого на free.

## Приоритеты внедрения (из анализа)

Сайты: (1) hostname-матчинг ~40 паттернов — самый дешёвый и точный сигнал;
(2) бейджи free-тарифов; (3) live-маркеры выше; (4) tier «vibe-хост» отдельно
от «AI-билдер» в UI. Медиа: ключи SD-чанков + Midjourney-профиль + бакеты.
