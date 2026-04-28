// Edge runtime برای کاهش latency و اجرای نزدیک به کاربر
export const config = { runtime: "edge" };

// آدرس مقصد (backend اصلی) از env گرفته میشه
// اسلش انتهایی حذف میشه برای جلوگیری از دوبل شدن در join مسیر
const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");

// هدرهایی که نباید به مقصد پاس داده بشن (مطابق RFC و جلوگیری از conflict)
const STRIP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

export default async function handler(req) {
  // اگر دامنه مقصد تنظیم نشده باشه، درخواست fail میشه
  if (!TARGET_BASE) {
    return new Response("Misconfigured: TARGET_DOMAIN is not set", { status: 500 });
  }

  try {
    // استخراج path از URL ورودی (بعد از protocol + domain)
    const pathStart = req.url.indexOf("/", 8);

    // ساخت URL نهایی برای forward کردن درخواست
    const targetUrl =
      pathStart === -1
        ? TARGET_BASE + "/"
        : TARGET_BASE + req.url.slice(pathStart);

    // ساخت هدرهای خروجی با فیلتر کردن موارد غیرمجاز
    const out = new Headers();
    let clientIp = null;

    for (const [k, v] of req.headers) {
      // حذف هدرهای حساس یا غیرقابل forward
      if (STRIP_HEADERS.has(k)) continue;

      // حذف هدرهای داخلی vercel
      if (k.startsWith("x-vercel-")) continue;

      // مدیریت IP واقعی کاربر برای حفظ chain
      if (k === "x-real-ip") {
        clientIp = v;
        continue;
      }

      if (k === "x-forwarded-for") {
        if (!clientIp) clientIp = v;
        continue;
      }

      // باقی هدرها بدون تغییر پاس داده میشن
      out.set(k, v);
    }

    // در صورت وجود IP، به صورت استاندارد اضافه میشه
    if (clientIp) out.set("x-forwarded-for", clientIp);

    const method = req.method;

    // فقط متدهایی غیر از GET/HEAD body دارن
    const hasBody = method !== "GET" && method !== "HEAD";

    // ارسال درخواست به مقصد با حفظ ساختار اصلی
    return await fetch(targetUrl, {
      method,
      headers: out,
      body: hasBody ? req.body : undefined,
      duplex: "half", // برای استریم در edge
      redirect: "manual", // جلوگیری از follow خودکار redirect
    });
  } catch (err) {
    // لاگ خطا برای دیباگ سمت سرور
    console.error("relay error:", err);

    // پاسخ fallback در صورت failure
    return new Response("Bad Gateway: Tunnel Failed", { status: 502 });
  }
}
