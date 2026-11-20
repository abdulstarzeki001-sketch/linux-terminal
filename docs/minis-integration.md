# STAR AI ULTRA × Open Minis — إعداد الربط

**الحالة:** التحديث على فرع GitHub للمراجعة. لم يتم دمجه أو نشره أو اختبار المحادثة من الآيفون. لا يوجد GPU مرتبط بهذه الخدمة حالياً.

## 1. ماذا يضيف هذا التحديث؟

- واجهة OpenAI-compatible: `GET /v1/models` و`POST /v1/chat/completions`.
- دعم استدعاء وظائف النموذج (`tool_calls`) مع موفري OpenAI Responses وKimi وخادم OpenAI-compatible خاص.
- خادم MCP مستقل على `POST /mcp` بتفويض Bearer token.
- أدوات MCP: `star_status`، `memory_save`، `memory_search`، `memory_delete`، `agent_rules_get`، `github_read_file`، `github_scan_file`، `github_stage_patch`، `github_pending_patches`، `web_check_headers`، `browserling_request`.
- صفحة مراجعة `GET /star-review` لعرض التعديلات واعتماد إنشاء Draft PR بعد فحصها.
- بدء الحاوية يضبط ملكية مجلد `/data` ثم يشغّل Node بدون صلاحيات root.

**لا ينفذ** shell غير محدود، أو برمجيات تجسس، أو سرقة جلسات، أو إخفاء آثار. أدوات GitHub لا تكتب إلى main ولا تدمج PR آلياً. Browserling يحفظ طلب فحص فقط؛ لا يبدأ جلسة Live API.

## 2. متغيرات Railway المطلوبة

على خدمة `star-ai-gateway` اضبط متغيرات مستقلة:

| المتغير | الوظيفة |
| --- | --- |
| `AI_ENABLED=1` | تفعيل المزوّد الفعلي **بعد** التأكد من إعداده |
| `AI_MODEL` | اسم النموذج الحقيقي لدى المزوّد (قد لا يكون Qwen) |
| `AI_PROVIDER` | `openai` أو `kimi` أو `selfhosted` |
| `AI_API_KEY` | مفتاح المزود إذا `openai` أو `kimi`؛ لا تشاركه |
| `STAR_MINIS_API_KEY` | مفتاح عشوائي طويل، مختلف، خاص بمحادثات Minis |
| `STAR_MINIS_MCP_KEY` | مفتاح طويل مستقل لأدوات MCP |
| `STAR_REVIEW_KEY` | مفتاح إداري مستقل لمراجعة التعديلات |
| `STAR_GITHUB_REPO` | `abdulstarzeki001-sketch/linux-terminal` أو مستودع آخر مصرح به |
| `STAR_GITHUB_TOKEN` | Fine-grained PAT محدود بالمستودع: Contents R/W وPull Requests R/W |
| `STAR_AUTHORIZED_HOSTS` | أسماء نطاقات مصرح بها للفحص السلبي، تفصل بفاصلة |
| `STAR_CUSTOM_INSTRUCTIONS` | تعليماتك الخاصة في الأسلوب والمهام التقنية |
| `STAR_AGENT_STATE_FILE` | `/data/star-agent-mcp.json` |

في وضع `selfhosted` يحتاج الكود الحالي أيضاً `AI_SELFHOST_URL`، `AI_SELFHOST_ALLOWED_HOST`، `AI_SELFHOST_API_KEY`، وتفاصيل الوصول الاختيارية كما في `provider.js`. يجب أن تشير إلى خدمة استدلال حقيقية متوافقة مع OpenAI؛ اسم `star-ai` في Minis مجرد alias.

**لا تضع الأسرار في GitHub أو في المحادثة.** على Railway احفظها كمتغيرات خدمة سرية. قد تتكبد تكاليف تشغيل أو استدلال على مزود مدفوع.

### الذاكرة الدائمة

أضف Railway Volume مخصّصاً على خدمة `star-ai-gateway` بمسار `/data`. بدون Volume، JSON المخزّن داخل الحاوية **غير مضمون الاستمرار** بعد إعادة نشرها. قبل النشر اختبر كتابة وحفظ واسترجاع ذاكرة عبر `memory_save` و`memory_search` ثم أعد تشغيل الحاوية واختبر الاسترجاع. لا ترفع ملف الذكريات إلى مستودع عام.

## 3. النشر الآمن

1. شغّل اختبارات CI وراجع Draft PR.
2. اضبط المزوّد الحقيقي وجرّب `/health` داخل Railway.
3. اضبط المفاتيح والـVolume والنطاقات المسموح فحصها.
4. ادمج PR بعد مراجعة الأمان ثم راقب سجلات النشر.
5. بعد حماية المسارات بمفاتيح قوية، أضف HTTPS domain للخدمة. لا تكشف المنفذ الخام لـOllama.
6. تأكد من `GET /v1/models` عبر Bearer key، و`POST /v1/chat/completions`، و`POST /mcp`، ثم جرّب من Minis.

## 4. Minis على الآيفون

**Provider:** Add Provider → OpenAI / Compatible API → API Key.

- Name: `STAR AI ULTRA`
- Base URL: `https://YOUR-DOMAIN/v1`، أو بدون `/v1` إذا كان Minis يضيفه تلقائياً.
- API Key: `STAR_MINIS_API_KEY`
- Model ID: `star-ai`

**MCP Tools:** إعدادات Minis → MCP Servers → إضافة Streamable HTTP server.

- Name: `STAR AI Tools`
- URL: `https://YOUR-DOMAIN/mcp`
- Header: `Authorization: Bearer <STAR_MINIS_MCP_KEY>`

يجب أن تظهر أدوات الذاكرة وGitHub في قائمة MCP. لعرض طلبات اعتماد تعديلات GitHub افتح `https://YOUR-DOMAIN/star-review` في Safari واستخدم `STAR_REVIEW_KEY` ثم راجع النص قبل الاعتماد.

**زر Save الافتراضي في Minis لا يحفظ تلقائياً داخل STAR AI**؛ للحفظ استخدم أداة `memory_save` من سياق المحادثة حتى تضيف الذكرى المقصودة. هذا تخزين سياق، وليس Fine-tuning للنموذج.

## 5. الاختبارات والحدود

```sh
node --test test/minis-api.test.js test/minis-tools.test.js
for file in ai-gateway/*.js; do node --check "$file"; done
```

الاختبارات الوحدوية تستخدم مزوّداً مزيّفاً؛ لا تثبت أن API المدفوع أو Qwen GPU أو Browserling أو GitHub PR تعمل فعلياً. البث عبر SSE **مُخزّن** حتى تنتهي إجابة المزوّد وليس تدفق رموز حياً. بعض أنماط أدوات/صور Minis غير مدعومة.

## 6. حدود التشغيل

- الربط الحالي يمرّر أدوات Minis إلى النموذج ويدعم خادم MCP منفصلاً.
- أدوات `github_stage_patch` تنتج مقترحاً لا يُكتب حتى مراجعة بشرية منفصلة؛ يصدر عنها فرع + Draft PR فقط.
- `web_check_headers` طلب HEAD سلبي على اسم نطاق مصرح به.
- `browserling_request` يضع الطلب في طابور، ولا يتصل بجلسة Browserling فعلية بدون API مخصص لاحقاً.
- لم ننشر خدمة GPU، ولا يوجد دليل على عمل Qwen في Railway.
