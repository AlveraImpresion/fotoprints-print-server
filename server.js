const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const net = require("net");
const tls = require("tls");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 8080);
const PRINTER_NAME = process.env.PRINTER_NAME || "";
const DISABLE_PRINT = process.env.DISABLE_PRINT === "1";
const DATA_DIR = process.env.DATA_DIR || __dirname;
const ORDERS_DIR = path.join(DATA_DIR, "orders");
const PROJECTS_DIR = path.join(DATA_DIR, "projects");
const EMAILS_DIR = path.join(DATA_DIR, "emails");
const REDSYS_PAYMENTS_DIR = path.join(DATA_DIR, "redsys-payments");
const CUSTOMERS_FILE = path.join(DATA_DIR, "customers.json");
const MAX_REQUEST_SIZE = 150 * 1024 * 1024;
const EMAIL_FROM = process.env.EMAIL_FROM || "fotoprints@alveraimpresion.com";
const EMAIL_SUBJECT = "Gracias por el Registro en LA APP, TE HAS TEGISTRADO CORRECTAMENTE";
const ORDER_EMAIL_SUBJECT = "Resumen de tu pedido en LA APP - Pago realizado con exito";
const PASSWORD_RECOVERY_SUBJECT = "Recuperacion de contraseña en LA APP";
const SMTP_HOST = process.env.SMTP_HOST || "mail.alveraimpresion.com";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || EMAIL_FROM;
const SMTP_PASS = process.env.SMTP_PASS || "";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "javier@alveraimpresion.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Jav1t3k029091974//*";
const APP_API_TOKEN = process.env.APP_API_TOKEN || "Wkq-DmE78CP69jcznk9HQgAhaXA5gnPynLGk4rNR0HA";
const AGENT_API_TOKEN = process.env.AGENT_API_TOKEN || "XDTybE4fA0vyix54uE_PKTT9yBjVlhOG8B2zvxVgJpo";
const ADMIN_SESSION_TOKEN = process.env.ADMIN_SESSION_TOKEN || crypto.randomBytes(32).toString("hex");
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "https://api.alveraimpresion.com";
const REDSYS_MERCHANT_CODE = process.env.REDSYS_MERCHANT_CODE || "124381955";
const REDSYS_TERMINAL = process.env.REDSYS_TERMINAL || "001";
const REDSYS_CURRENCY = process.env.REDSYS_CURRENCY || "978";
const REDSYS_SECRET_KEY = process.env.REDSYS_SECRET_KEY || "";
const REDSYS_ENDPOINT = process.env.REDSYS_ENDPOINT || "https://sis.redsys.es/sis/realizarPago";

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(ORDERS_DIR, { recursive: true });
fs.mkdirSync(PROJECTS_DIR, { recursive: true });
fs.mkdirSync(EMAILS_DIR, { recursive: true });
fs.mkdirSync(REDSYS_PAYMENTS_DIR, { recursive: true });
if (!fs.existsSync(CUSTOMERS_FILE)) {
  fs.writeFileSync(CUSTOMERS_FILE, "[]", "utf8");
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", chunk => {
      body += chunk;
      if (body.length > MAX_REQUEST_SIZE) {
        request.destroy();
        reject(new Error("Pedido demasiado grande"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function cleanFileName(value) {
  return String(value || "pedido")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80);
}

function renderTicketLogo() {
  return `<div class="brand">
    <svg class="brand-mark" viewBox="0 0 120 92" aria-label="Alvera Impresion">
      <path d="M19 75C12 49 23 22 51 12C48 41 39 61 19 75Z" fill="#90a0aa"/>
      <path d="M55 82C45 50 52 21 71 5C87 25 84 52 55 82Z" fill="#8495a2"/>
      <path d="M70 75C77 45 96 22 116 18C121 48 104 72 70 75Z" fill="#8fa1af"/>
      <path d="M21 77C35 76 47 72 58 62" fill="none" stroke="#dbeadf" stroke-width="3"/>
      <path d="M57 81C64 67 73 48 82 23" fill="none" stroke="#eadadd" stroke-width="3"/>
    </svg>
    <div class="brand-text">
      <strong>ALVERA</strong>
      <span>IMPRESION</span>
    </div>
  </div>`;
}

function buildTicket(order) {
  return [
    "==============================================",
    "            ALVERA IMPRESION",
    "                FOTOPRINTS",
    "==============================================",
    "",
    `PEDIDO: ${order.orderNumber || ""}`,
    `FECHA:  ${order.createdAt || ""}`,
    "",
    "DATOS DEL CLIENTE",
    "----------------------------------------------",
    `Nombre: ${order.customerName || ""}`,
    `Email: ${order.customerEmail || ""}`,
    `Telefono: ${order.customerPhone || ""}`,
    `Domicilio: ${order.customerAddress || ""}`,
    `Codigo postal: ${order.customerPostalCode || ""}`,
    `Ciudad: ${order.customerCity || ""}`,
    `Provincia: ${order.customerProvince || ""}`,
    `Indicaciones: ${order.deliveryNotes || ""}`,
    `Observaciones del pedido: ${order.orderNotes || ""}`,
    "",
    "DATOS DEL PEDIDO",
    "----------------------------------------------",
    `Tamano: ${order.printSize || ""}`,
    `Acabado: ${order.finish || ""}`,
    `Archivos seleccionados: ${order.photoCount || 0}`,
    `Copias totales: ${order.copyCount || 0}`,
    `Entrega: ${order.deliveryMethod || ""}`,
    `Direccion de recogida: ${order.storePickupAddress || ""}`,
    `Gastos de envio: ${order.formattedShippingCost || ""}`,
    `Subtotal: ${order.formattedItemsTotal || ""}`,
    `Descuento: ${order.discountPercent || 0}% (${order.formattedDiscountAmount || ""})`,
    `Forma de pago: ${order.paymentMethod || ""}`,
    `Estado del pago: ${order.paymentStatus || ""}`,
    `Instrucciones de pago: ${order.paymentInstructions || ""}`,
    `Telefono Bizum: ${order.bizumPhone || ""}`,
    `Precio por copia: ${order.unitPrice || ""}`,
    "",
    "TOTAL",
    "----------------------------------------------",
    `${order.formattedTotal || ""}`,
    "",
    "==============================================",
    " Revisar archivos antes de producir el pedido.",
    "==============================================",
    ""
  ].join("\r\n");
}

function buildTicketHtml(order) {
  const rows = [
    ["Pedido", order.orderNumber],
    ["Fecha", order.createdAt],
    ["Nombre", order.customerName],
    ["Email", order.customerEmail],
    ["Telefono", order.customerPhone],
    ["Domicilio", order.customerAddress],
    ["Codigo postal", order.customerPostalCode],
    ["Ciudad", order.customerCity],
    ["Provincia", order.customerProvince],
    ["Indicaciones", order.deliveryNotes],
    ["Observaciones", order.orderNotes],
    ["Tamano", order.printSize],
    ["Acabado", order.finish],
    ["Archivos", order.photoCount],
    ["Copias totales", order.copyCount],
    ["Entrega", order.deliveryMethod],
    ["Direccion recogida", order.storePickupAddress],
    ["Gastos de envio", order.formattedShippingCost],
    ["Subtotal", order.formattedItemsTotal],
    ["Descuento", `${order.discountPercent || 0}% (${order.formattedDiscountAmount || ""})`],
    ["Forma de pago", order.paymentMethod],
    ["Estado del pago", order.paymentStatus],
    ["Instrucciones", order.paymentInstructions],
    ["Telefono Bizum", order.bizumPhone],
    ["Precio por copia", order.unitPrice]
  ].filter(row => row[1] !== undefined && row[1] !== null && String(row[1]).trim() !== "");

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Hoja de pedido ${escapeHtml(order.orderNumber || "")}</title>
  <style>
    @page { margin: 14mm; }
    body { font-family: Arial, sans-serif; color: #1f1f1f; margin: 0; }
    .sheet { border: 1px solid #111; padding: 18px; }
    header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #111; padding-bottom: 14px; margin-bottom: 16px; }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-mark { width: 82px; height: 64px; display: block; }
    .brand-text { line-height: 1.05; letter-spacing: .08em; }
    .brand-text strong { display: block; font-size: 24px; }
    .brand-text span { display: block; font-size: 13px; font-weight: 700; letter-spacing: .22em; }
    .order { text-align: right; font-size: 14px; line-height: 1.5; }
    h2 { font-size: 15px; margin: 16px 0 8px; padding: 7px 9px; background: #f1f1f1; border: 1px solid #ddd; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    td { padding: 7px 8px; border-bottom: 1px solid #e5e5e5; vertical-align: top; }
    td:first-child { width: 34%; font-weight: 700; color: #333; }
    .total { margin-top: 18px; border: 2px solid #111; padding: 14px; text-align: right; font-size: 24px; font-weight: 800; }
    .note { margin-top: 14px; font-size: 12px; color: #555; text-align: center; }
  </style>
</head>
<body>
  <div class="sheet">
    <header>
      ${renderTicketLogo()}
      <div class="order"><strong>Hoja de pedido</strong><br>${escapeHtml(order.orderNumber || "")}<br>${escapeHtml(order.createdAt || "")}</div>
    </header>
    <h2>Datos del cliente y pedido</h2>
    <table>
      ${rows.map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`).join("")}
    </table>
    <div class="total">Total: ${escapeHtml(order.formattedTotal || "")}</div>
    <div class="note">Revisar archivos recibidos antes de producir el pedido.</div>
  </div>
</body>
</html>`;
}

function printTicket(ticketPath) {
  if (DISABLE_PRINT) {
    return Promise.resolve("Impresion desactivada");
  }

  return new Promise((resolve, reject) => {
    const args = PRINTER_NAME
      ? ["/pt", ticketPath, PRINTER_NAME]
      : ["/p", ticketPath];
    const process = spawn("notepad.exe", args, {
      detached: true,
      windowsHide: true,
      stdio: "ignore"
    });
    process.on("error", reject);
    process.unref();
    resolve(PRINTER_NAME ? `Enviado a ${PRINTER_NAME}` : "Enviado a la impresora predeterminada");
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, statusCode, html, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    ...headers
  });
  response.end(html);
}

function isAuthorized(request) {
  return request.headers["x-fotoprints-token"] === APP_API_TOKEN;
}

function isAgentAuthorized(request) {
  return request.headers["x-fotoprints-agent-token"] === AGENT_API_TOKEN;
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { ok: true, service: "FotoPrints print server" });
    return;
  }

  if (request.method === "GET" && (request.url === "/iphone" || request.url === "/iphone/")) {
    sendHtml(response, 200, renderIphoneAppPage());
    return;
  }

  if (request.method === "POST" && request.url === "/iphone/order") {
    await handleIphoneOrder(request, response);
    return;
  }

  if (request.method === "GET" && request.url.startsWith("/redsys/pay/")) {
    handleRedsysPayPage(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/redsys/notify") {
    await handleRedsysNotify(request, response);
    return;
  }

  if (request.method === "GET" && request.url === "/redsys/ok") {
    sendHtml(response, 200, renderPaymentResultPage("Pago realizado", "Tu pago con tarjeta se ha realizado correctamente."));
    return;
  }

  if (request.method === "GET" && request.url === "/redsys/ko") {
    sendHtml(response, 200, renderPaymentResultPage("Pago no completado", "El pago no se ha completado. Puedes volver a la app e intentarlo de nuevo."));
    return;
  }

  if (request.url === "/admin" || request.url.startsWith("/admin?")) {
    if (request.method !== "GET") {
      sendJson(response, 405, { ok: false, error: "Metodo no permitido" });
      return;
    }
    handleAdminPage(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/admin/web-login") {
    await handleAdminWebLogin(request, response);
    return;
  }

  if (request.method === "GET" && request.url === "/admin/logout") {
    sendHtml(response, 302, "", {
      "Location": "/admin",
      "Set-Cookie": "fotoprints_admin=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
    });
    return;
  }

  if (request.url === "/agent/orders" || request.url.startsWith("/agent/orders/")) {
    if (!isAgentAuthorized(request)) {
      sendJson(response, 401, { ok: false, error: "Agente no autorizado" });
      return;
    }
    await handleAgentRequest(request, response);
    return;
  }

  if (!isAuthorized(request)) {
    sendJson(response, 401, { ok: false, error: "No autorizado" });
    return;
  }

  if (request.method === "POST" && request.url === "/customer-registered") {
    try {
      const body = await readRequestBody(request);
      const customer = JSON.parse(body);
      saveRegisteredCustomer(customer);
      const result = await sendRegistrationEmail(customer);
      sendJson(response, 200, { ok: true, result });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && request.url === "/customer-updated") {
    try {
      const body = await readRequestBody(request);
      const customer = JSON.parse(body);
      saveRegisteredCustomer(customer);
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && request.url === "/customer-delete") {
    try {
      const body = await readRequestBody(request);
      const customer = JSON.parse(body);
      const deleted = deleteRegisteredCustomer(customer.email);
      sendJson(response, 200, { ok: true, deleted });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "GET" && request.url === "/admin/customers") {
    sendJson(response, 200, { ok: true, customers: readRegisteredCustomers() });
    return;
  }

  if (request.method === "GET" && request.url === "/admin/orders") {
    sendJson(response, 200, { ok: true, orders: readStoredOrders() });
    return;
  }

  if (request.method === "GET" && request.url === "/admin/storage") {
    sendJson(response, 200, getStorageStatus());
    return;
  }

  if (request.method === "POST" && request.url === "/password-recovery") {
    try {
      const body = await readRequestBody(request);
      const customer = JSON.parse(body);
      const result = await sendPasswordRecoveryEmail(customer);
      sendJson(response, 200, { ok: true, result });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && request.url === "/admin-login") {
    try {
      const body = await readRequestBody(request);
      const credentials = JSON.parse(body);
      const email = String(credentials.email || "").trim().toLowerCase();
      const password = String(credentials.password || "");
      const authenticated = email === ADMIN_EMAIL.toLowerCase() && password === ADMIN_PASSWORD;
      sendJson(response, authenticated ? 200 : 401, { ok: authenticated });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && request.url === "/save-project") {
    try {
      const body = await readRequestBody(request);
      const project = JSON.parse(body);
      const projectNumber = saveProject(project);
      sendJson(response, 200, { ok: true, projectNumber });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && request.url === "/redsys/create-payment") {
    try {
      const body = await readRequestBody(request);
      const payment = JSON.parse(body);
      const orderNumber = prepareRedsysPayment(payment);
      sendJson(response, 200, {
        ok: true,
        paymentUrl: `${PUBLIC_BASE_URL}/redsys/pay/${encodeURIComponent(orderNumber)}`
      });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method !== "POST" || request.url !== "/print-order") {
    sendJson(response, 404, { ok: false, error: "Ruta no encontrada" });
    return;
  }

  try {
    const body = await readRequestBody(request);
    const order = JSON.parse(body);
    const result = await storeIncomingOrder(order);
    sendJson(response, 200, {
      ok: true,
      orderNumber: result.orderNumber,
      printResult: result.printResult,
      emailResult: result.emailResult
    });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error.message
    });
  }
});

function saveOrderImages(order, imagesDir) {
  const images = Array.isArray(order.images) ? order.images : [];
  images.forEach((image, index) => {
    if (!image || !image.data) {
      return;
    }
    const fallbackName = `foto_${String(index + 1).padStart(3, "0")}.jpg`;
    const fileName = cleanImageFileName(image.fileName || fallbackName);
    const filePath = path.join(imagesDir, fileName);
    fs.writeFileSync(filePath, Buffer.from(image.data, "base64"));
  });
}

async function handleIphoneOrder(request, response) {
  try {
    const body = await readRequestBody(request);
    const order = JSON.parse(body);
    order.orderNumber = order.orderNumber || generateWebOrderNumber();
    order.createdAt = order.createdAt || formatSpanishDateTime(new Date());
    const result = await storeIncomingOrder(order);
    let paymentUrl = "";
    if (isCardPaymentPending(order)) {
      prepareRedsysPayment({
        orderNumber: result.orderNumber,
        amount: order.totalAmount,
        customerEmail: order.customerEmail,
        description: `Pedido FotoPrints ${result.orderNumber}`
      });
      paymentUrl = `${PUBLIC_BASE_URL}/redsys/pay/${encodeURIComponent(result.orderNumber)}`;
    }
    sendJson(response, 200, {
      ok: true,
      orderNumber: result.orderNumber,
      paymentUrl
    });
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error.message });
  }
}

async function storeIncomingOrder(order) {
  saveRegisteredCustomer({
    name: order.customerName,
    email: order.customerEmail,
    phone: order.customerPhone,
    address: order.customerAddress,
    postalCode: order.customerPostalCode,
    city: order.customerCity,
    province: order.customerProvince,
    deliveryNotes: order.deliveryNotes
  });
  const orderNumber = cleanFileName(order.orderNumber || generateWebOrderNumber());
  order.orderNumber = orderNumber;
  const orderDir = path.join(ORDERS_DIR, orderNumber);
  const imagesDir = path.join(orderDir, "imagenes");
  const jsonPath = path.join(orderDir, "pedido.json");
  const ticketPath = path.join(orderDir, "hoja_pedido.txt");
  const ticketHtmlPath = path.join(orderDir, "hoja_pedido.html");

  fs.mkdirSync(imagesDir, { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(buildStoredOrder(order), null, 2), "utf8");
  fs.writeFileSync(ticketPath, buildTicket(order), "utf8");
  fs.writeFileSync(ticketHtmlPath, buildTicketHtml(order), "utf8");
  saveOrderImages(order, imagesDir);

  let printResult = "Pendiente de confirmacion de pago";
  if (isCardPaymentPending(order)) {
    fs.writeFileSync(path.join(orderDir, "payment-pending.json"), JSON.stringify({
      orderNumber,
      createdAt: order.createdAt,
      receivedAt: new Date().toISOString(),
      paymentMethod: order.paymentMethod
    }, null, 2), "utf8");
  } else {
    markOrderPendingPrint(orderNumber, order.createdAt);
    printResult = await printTicket(ticketPath);
  }
  const emailResult = await sendOrderConfirmationEmail(order);
  return { orderNumber, printResult, emailResult };
}

function generateWebOrderNumber() {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(2, 14);
  const suffix = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return `WEB-${stamp}-${suffix}`;
}

function formatSpanishDateTime(date) {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

function buildStoredOrder(order) {
  const storedOrder = { ...order };
  storedOrder.images = (Array.isArray(order.images) ? order.images : []).map(image => ({
    fileName: image.fileName,
    mimeType: image.mimeType,
    type: image.type || "",
    originalName: image.originalName || "",
    copies: image.copies,
    edit: image.edit || null,
    manuallyCropped: Boolean(image.manuallyCropped)
  }));
  return storedOrder;
}

function isCardPaymentPending(order) {
  return String(order.paymentMethod || "").toLowerCase() === "tarjeta"
    && String(order.paymentStatus || "").toLowerCase().includes("pendiente");
}

function markOrderPendingPrint(orderNumber, createdAt = "") {
  const orderDir = path.join(ORDERS_DIR, cleanFileName(orderNumber));
  fs.writeFileSync(path.join(orderDir, "pending-print.json"), JSON.stringify({
    orderNumber,
    createdAt,
    receivedAt: new Date().toISOString()
  }, null, 2), "utf8");
}

function prepareRedsysPayment(payment) {
  if (!REDSYS_SECRET_KEY) {
    throw new Error("Redsys no tiene configurada la clave secreta");
  }
  const orderNumber = cleanFileName(payment.orderNumber);
  const amount = Math.round(Number(payment.amount || 0) * 100);
  if (!orderNumber || amount <= 0) {
    throw new Error("Datos de pago incompletos");
  }
  const paymentData = {
    orderNumber,
    redsysOrder: createRedsysOrderNumber(),
    amount,
    customerEmail: String(payment.customerEmail || "").trim(),
    description: String(payment.description || `Pedido ${orderNumber}`).slice(0, 120),
    createdAt: new Date().toISOString()
  };
  fs.writeFileSync(getRedsysPaymentPath(orderNumber), JSON.stringify(paymentData, null, 2), "utf8");
  fs.writeFileSync(getRedsysPaymentIndexPath(paymentData.redsysOrder), JSON.stringify({ orderNumber }, null, 2), "utf8");
  return orderNumber;
}

function getRedsysPaymentPath(orderNumber) {
  return path.join(REDSYS_PAYMENTS_DIR, `${cleanFileName(orderNumber)}.json`);
}

function getRedsysPaymentIndexPath(redsysOrder) {
  return path.join(REDSYS_PAYMENTS_DIR, `${cleanFileName(redsysOrder)}.index.json`);
}

function createRedsysOrderNumber() {
  return Date.now().toString().slice(-12);
}

function handleRedsysPayPage(request, response) {
  try {
    const orderNumber = cleanFileName(decodeURIComponent(request.url.split("/").pop() || ""));
    const paymentPath = getRedsysPaymentPath(orderNumber);
    if (!fs.existsSync(paymentPath)) {
      sendHtml(response, 404, renderPaymentResultPage("Pago no encontrado", "No encontramos este pago."));
      return;
    }
    const payment = JSON.parse(fs.readFileSync(paymentPath, "utf8"));
    const form = buildRedsysForm(payment);
    sendHtml(response, 200, renderRedsysAutoSubmitPage(form));
  } catch (error) {
    sendHtml(response, 500, renderPaymentResultPage("Error de pago", error.message));
  }
}

function buildRedsysForm(payment) {
  const params = {
    DS_MERCHANT_AMOUNT: String(payment.amount),
    DS_MERCHANT_ORDER: payment.redsysOrder,
    DS_MERCHANT_MERCHANTCODE: REDSYS_MERCHANT_CODE,
    DS_MERCHANT_CURRENCY: REDSYS_CURRENCY,
    DS_MERCHANT_TRANSACTIONTYPE: "0",
    DS_MERCHANT_TERMINAL: REDSYS_TERMINAL,
    DS_MERCHANT_MERCHANTURL: `${PUBLIC_BASE_URL}/redsys/notify`,
    DS_MERCHANT_URLOK: `${PUBLIC_BASE_URL}/redsys/ok`,
    DS_MERCHANT_URLKO: `${PUBLIC_BASE_URL}/redsys/ko`,
    DS_MERCHANT_PRODUCTDESCRIPTION: payment.description,
    DS_MERCHANT_TITULAR: payment.customerEmail || "Cliente FotoPrints"
  };
  const merchantParameters = Buffer.from(JSON.stringify(params), "utf8").toString("base64");
  return {
    endpoint: REDSYS_ENDPOINT,
    signatureVersion: "HMAC_SHA256_V1",
    merchantParameters,
    signature: createRedsysSignature(payment.redsysOrder, merchantParameters)
  };
}

function createRedsysSignature(orderNumber, merchantParameters) {
  const secret = Buffer.from(REDSYS_SECRET_KEY, "base64");
  const iv = Buffer.alloc(8, 0);
  const cipher = crypto.createCipheriv("des-ede3-cbc", secret, iv);
  const merchantKey = Buffer.concat([cipher.update(orderNumber, "utf8"), cipher.final()]);
  return crypto.createHmac("sha256", merchantKey).update(merchantParameters).digest("base64");
}

function renderRedsysAutoSubmitPage(form) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pago seguro</title>
</head>
<body>
  <p>Abriendo pago seguro...</p>
  <form id="redsysForm" action="${escapeHtml(form.endpoint)}" method="post">
    <input type="hidden" name="Ds_SignatureVersion" value="${escapeHtml(form.signatureVersion)}">
    <input type="hidden" name="Ds_MerchantParameters" value="${escapeHtml(form.merchantParameters)}">
    <input type="hidden" name="Ds_Signature" value="${escapeHtml(form.signature)}">
    <button type="submit">Continuar al pago</button>
  </form>
  <script>document.getElementById("redsysForm").submit();</script>
</body>
</html>`;
}

async function handleRedsysNotify(request, response) {
  try {
    const body = await readRequestBody(request);
    const params = new URLSearchParams(body);
    const merchantParameters = params.get("Ds_MerchantParameters") || params.get("Ds_MerchantParameters".toLowerCase()) || "";
    const signature = params.get("Ds_Signature") || params.get("Ds_Signature".toLowerCase()) || "";
    const decoded = JSON.parse(Buffer.from(merchantParameters, "base64").toString("utf8"));
    const redsysOrder = cleanFileName(decoded.Ds_Order || decoded.DS_ORDER || decoded.Ds_Merchant_Order || decoded.DS_MERCHANT_ORDER);
    const expectedSignature = createRedsysSignature(redsysOrder, merchantParameters);
    if (!constantTimeEqual(signature, expectedSignature)) {
      throw new Error("Firma Redsys no valida");
    }
    const responseCode = Number(decoded.Ds_Response || decoded.DS_RESPONSE || 9999);
    if (responseCode >= 0 && responseCode <= 99) {
      const orderNumber = getOrderNumberFromRedsysOrder(redsysOrder);
      markRedsysOrderPaid(orderNumber);
    }
    sendJson(response, 200, { ok: true });
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error.message });
  }
}

function getOrderNumberFromRedsysOrder(redsysOrder) {
  const indexPath = getRedsysPaymentIndexPath(redsysOrder);
  if (!fs.existsSync(indexPath)) {
    return redsysOrder;
  }
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  return cleanFileName(index.orderNumber || redsysOrder);
}

function constantTimeEqual(first, second) {
  const firstBuffer = Buffer.from(String(first));
  const secondBuffer = Buffer.from(String(second));
  return firstBuffer.length === secondBuffer.length && crypto.timingSafeEqual(firstBuffer, secondBuffer);
}

function markRedsysOrderPaid(orderNumber) {
  const orderDir = path.join(ORDERS_DIR, cleanFileName(orderNumber));
  const orderPath = path.join(orderDir, "pedido.json");
  if (!fs.existsSync(orderPath)) {
    return;
  }
  const order = JSON.parse(fs.readFileSync(orderPath, "utf8"));
  order.paymentStatus = "Pago realizado con exito";
  order.paymentInstructions = "Tarjeta - pago confirmado por Redsys";
  fs.writeFileSync(orderPath, JSON.stringify(order, null, 2), "utf8");
  const pendingPaymentPath = path.join(orderDir, "payment-pending.json");
  if (fs.existsSync(pendingPaymentPath)) {
    fs.unlinkSync(pendingPaymentPath);
  }
  fs.writeFileSync(path.join(orderDir, "paid-redsys.json"), JSON.stringify({
    orderNumber,
    paidAt: new Date().toISOString()
  }, null, 2), "utf8");
  markOrderPendingPrint(orderNumber, order.createdAt);
}

function renderPaymentResultPage(title, message) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body{font-family:Arial,sans-serif;margin:0;padding:32px;background:#f6f6f6;color:#202124}
    main{max-width:520px;margin:0 auto;background:white;border-radius:12px;padding:24px;text-align:center}
  </style>
</head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body>
</html>`;
}

function renderIphoneAppPage() {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="FotoPrints">
  <title>FotoPrints iPhone</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;background:#f4f4f4;color:#202124;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    header{position:sticky;top:0;z-index:3;background:#fff;border-bottom:1px solid #e3e3e3;padding:14px 18px;text-align:center}
    header h1{margin:0;font-size:21px}
    main{max-width:680px;margin:0 auto;padding:16px 14px 110px}
    section{background:#fff;border:1px solid #e1e1e1;border-radius:10px;padding:14px;margin:0 0 12px}
    h2{font-size:17px;margin:0 0 10px}
    label{display:block;font-weight:700;font-size:13px;margin:12px 0 6px}
    input,select,textarea{width:100%;border:1px solid #d7d7d7;border-radius:8px;padding:12px;font-size:16px;background:#fff;color:#202124}
    textarea{min-height:86px;resize:vertical}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .files{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}
    .file{border:1px solid #ddd;border-radius:8px;overflow:hidden;background:#fafafa;aspect-ratio:1;display:flex;align-items:center;justify-content:center;text-align:center;font-size:12px;padding:6px}
    .file img{width:100%;height:100%;object-fit:cover}
    .summary{line-height:1.5;color:#5f6368;font-size:15px}
    .total{font-size:31px;font-weight:800;text-align:center;margin:12px 0 2px}
    .bar{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid #ddd;padding:12px 14px calc(12px + env(safe-area-inset-bottom));display:flex;gap:10px}
    button{border:0;border-radius:8px;font-weight:800;font-size:16px;padding:14px 16px}
    .primary{background:#111;color:#fff;flex:1}
    .secondary{background:#fff;color:#111;border:1px solid #bbb}
    .notice{font-size:13px;color:#5f6368;text-align:center;margin-top:8px}
    .ok{color:#137333;font-weight:700}
    .error{color:#b3261e;font-weight:700}
  </style>
</head>
<body>
  <header><h1>FotoPrints</h1></header>
  <main>
    <section>
      <h2>Archivos</h2>
      <input id="files" type="file" accept="image/*,application/pdf" multiple>
      <div id="fileGrid" class="files"></div>
    </section>

    <section>
      <h2>Cliente</h2>
      <label>Nombre</label><input id="name" autocomplete="name">
      <label>Email</label><input id="email" type="email" autocomplete="email">
      <label>Telefono</label><input id="phone" type="tel" autocomplete="tel">
      <label>Domicilio</label><input id="address" autocomplete="street-address">
      <div class="grid">
        <div><label>Codigo postal</label><input id="postalCode" inputmode="numeric"></div>
        <div><label>Ciudad</label><input id="city" value="Madrid"></div>
      </div>
      <label>Provincia</label><input id="province" value="Madrid">
      <label>Indicaciones de entrega</label><textarea id="deliveryNotes"></textarea>
    </section>

    <section>
      <h2>Pedido</h2>
      <div class="grid">
        <div>
          <label>Tamano</label>
          <select id="printSize"><option>10x15</option><option>15x20</option></select>
        </div>
        <div>
          <label>Acabado</label>
          <select id="finish"><option>Brillo</option><option>Lustre</option></select>
        </div>
      </div>
      <label>Copias por archivo</label><input id="copies" type="number" min="1" value="1">
      <label>Entrega</label>
      <select id="deliveryMethod"><option>Envio a domicilio</option><option>Recogida en tienda</option></select>
      <label>Forma de pago</label>
      <select id="paymentMethod"><option>Bizum</option><option>Tarjeta</option><option>PayPal</option><option>Pago en tienda</option><option>Envio de prueba</option></select>
      <label>Observaciones del pedido</label><textarea id="orderNotes"></textarea>
    </section>

    <section>
      <h2>Resumen</h2>
      <div id="summary" class="summary"></div>
      <div id="total" class="total">0,00 €</div>
      <div class="notice">IVA incluido</div>
      <div id="status" class="notice"></div>
    </section>
  </main>
  <div class="bar">
    <button class="secondary" id="recalcButton" type="button">Actualizar</button>
    <button class="primary" id="sendButton" type="button">Enviar pedido</button>
  </div>
  <script>
    const filesInput = document.getElementById("files");
    const fileGrid = document.getElementById("fileGrid");
    const statusBox = document.getElementById("status");
    const totalBox = document.getElementById("total");
    const summaryBox = document.getElementById("summary");
    const shippingCost = 4.5;
    const freeShippingThreshold = 50;

    function euro(value){return new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR"}).format(value)}
    function unitPrice(size,copies){return size === "15x20" ? (copies >= 50 ? 0.48 : 0.55) : (copies >= 50 ? 0.25 : 0.32)}
    function selectedFiles(){return Array.from(filesInput.files || [])}
    function calculate(){
      const count = selectedFiles().length;
      const copiesEach = Math.max(1, Number(document.getElementById("copies").value || 1));
      const copies = count * copiesEach;
      const size = document.getElementById("printSize").value;
      const payment = document.getElementById("paymentMethod").value;
      const delivery = document.getElementById("deliveryMethod").value;
      const items = unitPrice(size, copies) * copies;
      const firstPromo = Math.min(copies, 20) * unitPrice(size, copies);
      let afterPromo = Math.max(0, items - firstPromo);
      let shipping = delivery === "Recogida en tienda" || afterPromo >= freeShippingThreshold ? 0 : shippingCost;
      let total = afterPromo + shipping;
      if (payment === "Envio de prueba") total = 0;
      summaryBox.innerHTML = "Archivos: " + count + "<br>Copias: " + copies + "<br>Tamano: " + size + "<br>Entrega: " + delivery + "<br>Pago: " + payment + "<br>Descuento primeras 20 fotos: " + euro(firstPromo) + "<br>Envio: " + euro(shipping);
      totalBox.textContent = euro(total);
      return {count,copiesEach,copies,size,payment,delivery,items,firstPromo,shipping,total};
    }
    function renderFiles(){
      fileGrid.innerHTML = "";
      selectedFiles().forEach(file => {
        const div = document.createElement("div");
        div.className = "file";
        if (file.type.startsWith("image/")) {
          const img = document.createElement("img");
          img.src = URL.createObjectURL(file);
          div.appendChild(img);
        } else {
          div.textContent = "PDF\\n" + file.name;
        }
        fileGrid.appendChild(div);
      });
      calculate();
    }
    function readFileBase64(file){
      return new Promise((resolve,reject)=>{
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }
    async function buildImages(){
      const copiesEach = Math.max(1, Number(document.getElementById("copies").value || 1));
      const images = [];
      for (let i=0;i<selectedFiles().length;i++){
        const file = selectedFiles()[i];
        const isPdf = file.type === "application/pdf";
        images.push({
          fileName: (isPdf ? "documento_" : "foto_") + String(i+1).padStart(3,"0") + (isPdf ? ".pdf" : ".jpg"),
          mimeType: file.type || (isPdf ? "application/pdf" : "image/jpeg"),
          type: isPdf ? "pdf" : "image",
          originalName: file.name,
          copies: copiesEach,
          data: await readFileBase64(file)
        });
      }
      return images;
    }
    async function sendOrder(){
      const calc = calculate();
      if (!calc.count){statusBox.innerHTML = "<span class='error'>Selecciona fotos o PDF.</span>";return}
      const required = ["name","email","phone","address","postalCode","city","province"];
      for (const id of required){if(!document.getElementById(id).value.trim()){statusBox.innerHTML = "<span class='error'>Completa los datos del cliente.</span>";return}}
      statusBox.textContent = "Preparando pedido...";
      document.getElementById("sendButton").disabled = true;
      try{
        const order = {
          customerName: document.getElementById("name").value.trim(),
          customerEmail: document.getElementById("email").value.trim(),
          customerPhone: document.getElementById("phone").value.trim(),
          customerAddress: document.getElementById("address").value.trim(),
          customerPostalCode: document.getElementById("postalCode").value.trim(),
          customerCity: document.getElementById("city").value.trim(),
          customerProvince: document.getElementById("province").value.trim(),
          deliveryNotes: document.getElementById("deliveryNotes").value.trim(),
          orderNotes: document.getElementById("orderNotes").value.trim(),
          printSize: calc.size,
          finish: document.getElementById("finish").value,
          photoCount: calc.count,
          copyCount: calc.copies,
          deliveryMethod: calc.delivery,
          shippingCost: calc.shipping,
          formattedShippingCost: euro(calc.shipping),
          storePickupAddress: calc.delivery === "Recogida en tienda" ? "Alvera Impresion, Calle San German 72 Local Izq, 28020 Madrid" : "",
          itemsTotal: calc.items,
          formattedItemsTotal: euro(calc.items),
          discountPercent: calc.payment === "Envio de prueba" ? 100 : 0,
          discountAmount: calc.payment === "Envio de prueba" ? calc.items + calc.shipping : calc.firstPromo,
          formattedDiscountAmount: euro(calc.payment === "Envio de prueba" ? calc.items + calc.shipping : calc.firstPromo),
          firstPromoFreeCopies: calc.firstPromo > 0 ? 20 : 0,
          firstPromoDiscount: calc.firstPromo,
          paymentMethod: calc.payment,
          paymentStatus: calc.payment === "Tarjeta" ? "Pendiente de pago con tarjeta" : (calc.payment === "Bizum" || calc.payment === "Pago en tienda" ? "Pendiente de confirmacion" : "Pago realizado con exito"),
          paymentInstructions: calc.payment,
          unitPrice: unitPrice(calc.size, calc.copies),
          totalAmount: calc.total,
          formattedTotal: euro(calc.total),
          images: await buildImages()
        };
        const response = await fetch("/iphone/order",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(order)});
        const payload = await response.json();
        if(!response.ok || !payload.ok) throw new Error(payload.error || "No se pudo enviar el pedido");
        statusBox.innerHTML = "<span class='ok'>Pedido " + payload.orderNumber + " creado correctamente.</span>";
        if(payload.paymentUrl){window.location.href = payload.paymentUrl}
      }catch(error){
        statusBox.innerHTML = "<span class='error'>" + error.message + "</span>";
      }finally{
        document.getElementById("sendButton").disabled = false;
      }
    }
    filesInput.addEventListener("change", renderFiles);
    document.getElementById("recalcButton").addEventListener("click", calculate);
    document.getElementById("sendButton").addEventListener("click", sendOrder);
    document.querySelectorAll("input,select,textarea").forEach(el => el.addEventListener("change", calculate));
    calculate();
  </script>
</body>
</html>`;
}

function readRegisteredCustomers() {
  try {
    const raw = fs.readFileSync(CUSTOMERS_FILE, "utf8");
    const customers = JSON.parse(raw);
    return Array.isArray(customers) ? customers : [];
  } catch (error) {
    return [];
  }
}

function handleAdminPage(request, response) {
  if (!isAdminWebAuthenticated(request)) {
    sendHtml(response, 200, renderAdminLoginPage());
    return;
  }

  const requestUrl = new URL(request.url, "http://localhost");
  const section = requestUrl.searchParams.get("section") === "orders" ? "orders" : "customers";
  sendHtml(response, 200, renderAdminDashboard(section));
}

async function handleAdminWebLogin(request, response) {
  try {
    const body = await readRequestBody(request);
    const params = new URLSearchParams(body);
    const email = String(params.get("email") || "").trim().toLowerCase();
    const password = String(params.get("password") || "");

    if (email === ADMIN_EMAIL.toLowerCase() && password === ADMIN_PASSWORD) {
      sendHtml(response, 302, "", {
        "Location": "/admin",
        "Set-Cookie": `fotoprints_admin=${ADMIN_SESSION_TOKEN}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`
      });
      return;
    }

    sendHtml(response, 401, renderAdminLoginPage("Usuario o contrasena incorrectos"));
  } catch (error) {
    sendHtml(response, 500, renderAdminLoginPage("No se pudo iniciar sesion"));
  }
}

function isAdminWebAuthenticated(request) {
  const cookieHeader = String(request.headers.cookie || "");
  return cookieHeader.split(";")
    .map(item => item.trim())
    .some(item => item === `fotoprints_admin=${ADMIN_SESSION_TOKEN}`);
}

function renderAdminLoginPage(errorMessage = "") {
  return buildAdminHtml(`
    <main class="login">
      <section class="panel">
        <h1>Administracion</h1>
        <p class="muted">Acceso privado de Alvera Impresion</p>
        ${errorMessage ? `<div class="error">${escapeHtml(errorMessage)}</div>` : ""}
        <form method="post" action="/admin/web-login">
          <label>Email</label>
          <input name="email" type="email" autocomplete="username" required>
          <label>Contrasena</label>
          <input name="password" type="password" autocomplete="current-password" required>
          <button type="submit">Entrar</button>
        </form>
      </section>
    </main>
  `);
}

function renderAdminDashboard(section) {
  const customers = readRegisteredCustomers();
  const orders = readStoredOrders();
  const totalRevenue = orders.reduce((sum, order) => sum + parseMoney(order.total || order.formattedTotal), 0);
  const activeRows = section === "orders" ? renderOrdersTable(orders) : renderCustomersTable(customers);

  return buildAdminHtml(`
    <header>
      <div>
        <h1>Administracion</h1>
        <p class="muted">Clientes, pedidos y facturacion</p>
      </div>
      <a class="logout" href="/admin/logout">Salir</a>
    </header>
    <section class="summary">
      <div><span>Clientes</span><strong>${customers.length}</strong></div>
      <div><span>Pedidos</span><strong>${orders.length}</strong></div>
      <div><span>Facturacion</span><strong>${formatEuro(totalRevenue)}</strong></div>
    </section>
    <nav class="tabs">
      <a class="${section === "customers" ? "active" : ""}" href="/admin?section=customers">Clientes</a>
      <a class="${section === "orders" ? "active" : ""}" href="/admin?section=orders">Pedidos</a>
    </nav>
    <section class="table-panel">
      ${activeRows}
    </section>
  `);
}

function renderCustomersTable(customers) {
  if (!customers.length) {
    return `<p class="empty">Todavia no hay clientes registrados.</p>`;
  }
  const rows = customers.map(customer => `
    <tr>
      <td>${escapeHtml(customer.name)}</td>
      <td>${escapeHtml(customer.email)}</td>
      <td>${escapeHtml(customer.phone)}</td>
      <td>${escapeHtml(customer.address)}</td>
      <td>${escapeHtml(customer.postalCode)}</td>
      <td>${escapeHtml(customer.city)}</td>
      <td>${escapeHtml(customer.province)}</td>
      <td>${formatDate(customer.registeredAt)}</td>
      <td>${formatDate(customer.updatedAt)}</td>
    </tr>
  `).join("");

  return `
    <h2>Clientes</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Email</th>
            <th>Telefono</th>
            <th>Domicilio</th>
            <th>Codigo postal</th>
            <th>Ciudad</th>
            <th>Provincia</th>
            <th>Registro</th>
            <th>Actualizado</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderOrdersTable(orders) {
  if (!orders.length) {
    return `<p class="empty">Todavia no hay pedidos realizados.</p>`;
  }
  const rows = orders.map(order => `
    <tr>
      <td>${escapeHtml(order.orderNumber)}</td>
      <td>${formatDate(order.createdAt)}</td>
      <td>${escapeHtml(order.customerName)}</td>
      <td>${escapeHtml(order.customerEmail)}</td>
      <td>${escapeHtml(order.customerPhone)}</td>
      <td>${escapeHtml(order.customerProvince)}</td>
      <td>${escapeHtml(order.deliveryMethod)}</td>
      <td>${escapeHtml(order.paymentMethod)}</td>
      <td>${escapeHtml(order.photoCount)}</td>
      <td>${escapeHtml(order.copyCount)}</td>
      <td>${escapeHtml(order.formattedTotal || order.total)}</td>
      <td>${escapeHtml(order.orderNotes)}</td>
    </tr>
  `).join("");

  return `
    <h2>Pedidos</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Pedido</th>
            <th>Fecha</th>
            <th>Cliente</th>
            <th>Email</th>
            <th>Telefono</th>
            <th>Provincia</th>
            <th>Entrega</th>
            <th>Pago</th>
            <th>Archivos</th>
            <th>Copias</th>
            <th>Total</th>
            <th>Observaciones</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function buildAdminHtml(content) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Administracion FotoPrints</title>
  <style>
    :root { color-scheme: light; --ink: #17212b; --muted: #647282; --line: #dbe3ea; --brand: #0f766e; --soft: #eef7f5; --danger: #b42318; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, sans-serif; color: var(--ink); background: #f7f9fb; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 24px 28px; background: #ffffff; border-bottom: 1px solid var(--line); }
    h1, h2, p { margin: 0; }
    h1 { font-size: 28px; }
    h2 { font-size: 20px; margin-bottom: 16px; }
    .muted { color: var(--muted); margin-top: 6px; }
    .logout, .tabs a, button { border: 1px solid var(--line); border-radius: 8px; color: var(--ink); background: #ffffff; text-decoration: none; padding: 10px 14px; font-weight: 700; }
    .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding: 18px 28px 0; }
    .summary div { background: #ffffff; border: 1px solid var(--line); border-radius: 8px; padding: 16px; }
    .summary span { display: block; color: var(--muted); font-size: 13px; }
    .summary strong { display: block; margin-top: 8px; font-size: 24px; }
    .tabs { display: flex; gap: 8px; padding: 18px 28px; }
    .tabs a.active, button { background: var(--brand); color: #ffffff; border-color: var(--brand); }
    .table-panel { padding: 0 28px 28px; }
    .table-wrap { overflow: auto; background: #ffffff; border: 1px solid var(--line); border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; min-width: 980px; }
    th, td { border-bottom: 1px solid var(--line); padding: 12px; text-align: left; vertical-align: top; font-size: 14px; }
    th { background: var(--soft); color: #25313d; position: sticky; top: 0; }
    tr:last-child td { border-bottom: 0; }
    .empty { background: #ffffff; border: 1px solid var(--line); border-radius: 8px; padding: 18px; color: var(--muted); }
    .login { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .panel { width: min(420px, 100%); background: #ffffff; border: 1px solid var(--line); border-radius: 10px; padding: 24px; box-shadow: 0 18px 60px rgba(16, 24, 40, .08); }
    form { display: grid; gap: 10px; margin-top: 18px; }
    label { font-weight: 700; font-size: 14px; }
    input { width: 100%; border: 1px solid var(--line); border-radius: 8px; padding: 12px; font-size: 16px; }
    button { cursor: pointer; margin-top: 8px; }
    .error { margin-top: 14px; background: #fff1f0; color: var(--danger); border: 1px solid #fecdca; border-radius: 8px; padding: 10px; }
    @media (max-width: 720px) {
      header { align-items: flex-start; flex-direction: column; }
      .summary { grid-template-columns: 1fr; }
      h1 { font-size: 24px; }
    }
  </style>
</head>
<body>${content}</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return escapeHtml(value);
  }
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

function parseMoney(value) {
  const normalized = String(value || "0").replace(/[^\d,.-]/g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function formatEuro(value) {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR"
  }).format(value);
}

function saveRegisteredCustomer(customer) {
  const email = String(customer.email || "").trim().toLowerCase();
  if (!email) {
    return;
  }
  const customers = readRegisteredCustomers();
  const existingIndex = customers.findIndex(item => String(item.email || "").toLowerCase() === email);
  const existingCustomer = existingIndex >= 0 ? customers[existingIndex] : {};
  const storedCustomer = {
    name: String(customer.name || existingCustomer.name || "").trim(),
    email,
    phone: String(customer.phone || customer.customerPhone || existingCustomer.phone || "").trim(),
    address: String(customer.address || customer.customerAddress || existingCustomer.address || "").trim(),
    postalCode: String(customer.postalCode || customer.customerPostalCode || existingCustomer.postalCode || "").trim(),
    city: String(customer.city || customer.customerCity || existingCustomer.city || "").trim(),
    province: String(customer.province || customer.customerProvince || existingCustomer.province || "").trim(),
    deliveryNotes: String(customer.deliveryNotes || existingCustomer.deliveryNotes || "").trim(),
    registeredAt: existingCustomer.registeredAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (existingIndex >= 0) {
    customers[existingIndex] = { ...existingCustomer, ...storedCustomer };
  } else {
    customers.push(storedCustomer);
  }
  fs.writeFileSync(CUSTOMERS_FILE, JSON.stringify(customers, null, 2), "utf8");
}

function deleteRegisteredCustomer(emailValue) {
  const email = String(emailValue || "").trim().toLowerCase();
  if (!email) {
    throw new Error("Falta el email del cliente");
  }
  const customers = readRegisteredCustomers();
  const remainingCustomers = customers.filter(item => String(item.email || "").toLowerCase() !== email);
  fs.writeFileSync(CUSTOMERS_FILE, JSON.stringify(remainingCustomers, null, 2), "utf8");
  return customers.length - remainingCustomers.length;
}

function readStoredOrders() {
  if (!fs.existsSync(ORDERS_DIR)) {
    return [];
  }
  return fs.readdirSync(ORDERS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const jsonPath = path.join(ORDERS_DIR, entry.name, "pedido.json");
      if (!fs.existsSync(jsonPath)) {
        return null;
      }
      try {
        return JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((first, second) => String(second.createdAt || "").localeCompare(String(first.createdAt || "")));
}

function getStorageStatus() {
  const markerPath = path.join(DATA_DIR, "storage-check.txt");
  const writtenAt = new Date().toISOString();
  try {
    fs.writeFileSync(markerPath, `FotoPrints storage check ${writtenAt}\n`, "utf8");
    return {
      ok: true,
      dataDir: DATA_DIR,
      customersFile: CUSTOMERS_FILE,
      customersCount: readRegisteredCustomers().length,
      ordersCount: readStoredOrders().length,
      markerPath,
      markerExists: fs.existsSync(markerPath),
      writtenAt
    };
  } catch (error) {
    return {
      ok: false,
      dataDir: DATA_DIR,
      customersFile: CUSTOMERS_FILE,
      error: error.message
    };
  }
}

function saveProject(project) {
  const projectNumber = getNextProjectNumber();
  const customerFolder = cleanFileName(project.customerEmail || "cliente");
  const projectDir = path.join(PROJECTS_DIR, customerFolder, projectNumber);
  const imagesDir = path.join(projectDir, "imagenes");

  fs.mkdirSync(imagesDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "proyecto.json"),
    JSON.stringify(buildStoredProject(project, projectNumber), null, 2),
    "utf8"
  );
  saveOrderImages(project, imagesDir);
  return projectNumber;
}

function getNextProjectNumber() {
  let maxNumber = 0;
  if (fs.existsSync(PROJECTS_DIR)) {
    const customerDirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }).filter(entry => entry.isDirectory());
    for (const customerDir of customerDirs) {
      const customerPath = path.join(PROJECTS_DIR, customerDir.name);
      const projectDirs = fs.readdirSync(customerPath, { withFileTypes: true }).filter(entry => entry.isDirectory());
      for (const projectDir of projectDirs) {
        const match = projectDir.name.match(/^PR-(\d+)$/);
        if (match) {
          maxNumber = Math.max(maxNumber, Number(match[1]));
        }
      }
    }
  }
  return `PR-${String(maxNumber + 1).padStart(6, "0")}`;
}

function buildStoredProject(project, projectNumber) {
  return {
    ...project,
    projectNumber,
    savedAt: new Date().toISOString(),
    images: (Array.isArray(project.images) ? project.images : []).map(image => ({
      fileName: image.fileName,
      mimeType: image.mimeType,
      copies: image.copies,
      edit: image.edit || null,
      manuallyCropped: Boolean(image.manuallyCropped)
    }))
  };
}

function cleanImageFileName(value) {
  const fileName = path.basename(String(value || "foto.jpg"));
  const cleanName = fileName.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 100);
  if (cleanName.includes(".")) {
    return cleanName;
  }
  return `${cleanName}.jpg`;
}

async function handleAgentRequest(request, response) {
  const requestUrl = new URL(request.url, "http://localhost");
  const parts = requestUrl.pathname.split("/").filter(Boolean);

  if (request.method === "GET" && requestUrl.pathname === "/agent/orders") {
    sendJson(response, 200, { ok: true, orders: getPendingPrintOrders() });
    return;
  }

  if (parts.length === 3 && parts[0] === "agent" && parts[1] === "orders" && request.method === "GET") {
    const orderNumber = cleanFileName(decodeURIComponent(parts[2]));
    const orderPayload = getAgentOrderPayload(orderNumber);
    if (!orderPayload) {
      sendJson(response, 404, { ok: false, error: "Pedido no encontrado" });
      return;
    }
    sendJson(response, 200, { ok: true, order: orderPayload });
    return;
  }

  if (parts.length === 4 && parts[0] === "agent" && parts[1] === "orders"
      && parts[3] === "printed" && request.method === "POST") {
    const orderNumber = cleanFileName(decodeURIComponent(parts[2]));
    markOrderPrinted(orderNumber);
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 404, { ok: false, error: "Ruta de agente no encontrada" });
}

function getPendingPrintOrders() {
  if (!fs.existsSync(ORDERS_DIR)) {
    return [];
  }
  return fs.readdirSync(ORDERS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(orderNumber => fs.existsSync(path.join(ORDERS_DIR, orderNumber, "pending-print.json")))
    .map(orderNumber => {
      const orderPath = path.join(ORDERS_DIR, orderNumber, "pedido.json");
      let order = {};
      if (fs.existsSync(orderPath)) {
        order = JSON.parse(fs.readFileSync(orderPath, "utf8"));
      }
      return {
        orderNumber,
        createdAt: order.createdAt || "",
        customerName: order.customerName || "",
        total: order.formattedTotal || ""
      };
    });
}

function getAgentOrderPayload(orderNumber) {
  const orderDir = path.join(ORDERS_DIR, cleanFileName(orderNumber));
  const orderPath = path.join(orderDir, "pedido.json");
  const ticketPath = path.join(orderDir, "hoja_pedido.txt");
  const ticketHtmlPath = path.join(orderDir, "hoja_pedido.html");
  if (!fs.existsSync(orderPath) || !fs.existsSync(ticketPath)) {
    return null;
  }

  const order = JSON.parse(fs.readFileSync(orderPath, "utf8"));
  return {
    order,
    ticketText: fs.readFileSync(ticketPath, "utf8"),
    ticketHtml: fs.existsSync(ticketHtmlPath)
      ? fs.readFileSync(ticketHtmlPath, "utf8")
      : buildTicketHtml(order),
    images: readAgentOrderImages(path.join(orderDir, "imagenes"))
  };
}

function readAgentOrderImages(imagesDir) {
  if (!fs.existsSync(imagesDir)) {
    return [];
  }
  return fs.readdirSync(imagesDir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => {
      const filePath = path.join(imagesDir, entry.name);
      return {
        fileName: entry.name,
        data: fs.readFileSync(filePath).toString("base64")
      };
    });
}

function markOrderPrinted(orderNumber) {
  const orderDir = path.join(ORDERS_DIR, cleanFileName(orderNumber));
  const pendingPath = path.join(orderDir, "pending-print.json");
  if (fs.existsSync(pendingPath)) {
    fs.unlinkSync(pendingPath);
  }
  fs.writeFileSync(path.join(orderDir, "printed.json"), JSON.stringify({
    orderNumber,
    printedAt: new Date().toISOString()
  }, null, 2), "utf8");
}

async function sendRegistrationEmail(customer) {
  const email = String(customer.email || "").trim();
  const name = String(customer.name || "cliente").trim();
  if (!email) {
    throw new Error("Falta el email del cliente");
  }

  const message = buildRegistrationEmailMessage(email, name);
  if (!SMTP_HOST || !SMTP_PASS) {
    const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}_${cleanFileName(email)}.eml`;
    fs.writeFileSync(path.join(EMAILS_DIR, fileName), message, "utf8");
    return "SMTP no configurado. Email guardado en la carpeta emails.";
  }

  await sendSmtpMail(email, message);
  return "Email enviado";
}

async function sendPasswordRecoveryEmail(customer) {
  const email = String(customer.email || "").trim();
  const name = String(customer.name || "cliente").trim();
  const password = String(customer.password || "").trim();
  if (!email || !password) {
    throw new Error("Faltan datos para recuperar la contraseña");
  }

  const message = buildPasswordRecoveryEmailMessage(email, name, password);
  if (!SMTP_HOST || !SMTP_PASS) {
    const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}_${cleanFileName(email)}_recuperacion.eml`;
    fs.writeFileSync(path.join(EMAILS_DIR, fileName), message, "utf8");
    return "SMTP no configurado. Email de recuperacion guardado en la carpeta emails.";
  }

  await sendSmtpMail(email, message);
  return "Email de recuperacion enviado";
}

async function sendOrderConfirmationEmail(order) {
  const email = String(order.customerEmail || "").trim();
  if (!email) {
    return "Pedido sin email de cliente";
  }

  const message = buildOrderConfirmationEmailMessage(order);
  if (!SMTP_HOST || !SMTP_PASS) {
    const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}_${cleanFileName(order.orderNumber)}_pedido.eml`;
    fs.writeFileSync(path.join(EMAILS_DIR, fileName), message, "utf8");
    return "SMTP no configurado. Email de pedido guardado en la carpeta emails.";
  }

  await sendSmtpMail(email, message);
  return "Email de pedido enviado";
}

function buildRegistrationEmailMessage(email, name) {
  const body = [
    `Hola ${name},`,
    "",
    "Gracias por registrarte en LA APP.",
    "Tu registro se ha realizado correctamente.",
    "",
    "A partir de ahora podras realizar pedidos y consultar tus datos desde Mi Cuenta.",
    "",
    "Atentamente,",
    "Alvera Impresion"
  ].join("\r\n");

  return [
    `From: Alvera Impresion <${EMAIL_FROM}>`,
    `To: ${email}`,
    `Subject: ${EMAIL_SUBJECT}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
    ""
  ].join("\r\n");
}

function buildPasswordRecoveryEmailMessage(email, name, password) {
  const body = [
    `Hola ${name},`,
    "",
    "Hemos recibido una solicitud para recuperar tu contraseña en LA APP.",
    "",
    `Tu contraseña actual es: ${password}`,
    "",
    "Si no has solicitado esta recuperacion, puedes ignorar este email.",
    "",
    "Atentamente,",
    "Alvera Impresion"
  ].join("\r\n");

  return [
    `From: Alvera Impresion <${EMAIL_FROM}>`,
    `To: ${email}`,
    `Subject: ${PASSWORD_RECOVERY_SUBJECT}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
    ""
  ].join("\r\n");
}

function buildOrderConfirmationEmailMessage(order) {
  const email = String(order.customerEmail || "").trim();
  const name = String(order.customerName || "cliente").trim();
  const paymentDone = order.paymentStatus === "Pago realizado con exito";
  const body = [
    `Hola ${name},`,
    "",
    paymentDone
      ? "Tu pedido se ha realizado correctamente y el pago se ha confirmado con exito."
      : "Tu pedido se ha realizado correctamente. El pago queda pendiente para abonarlo en tienda.",
    "",
    "RESUMEN DEL PEDIDO",
    `Numero de pedido: ${order.orderNumber || ""}`,
    `Fecha: ${order.createdAt || ""}`,
    `Tamano: ${order.printSize || ""}`,
    `Acabado: ${order.finish || ""}`,
    `Archivos seleccionados: ${order.photoCount || 0}`,
    `Copias totales: ${order.copyCount || 0}`,
    `Entrega: ${order.deliveryMethod || ""}`,
    `Gastos de envio: ${order.formattedShippingCost || ""}`,
    `Subtotal: ${order.formattedItemsTotal || ""}`,
    `Descuento: ${order.discountPercent || 0}% (${order.formattedDiscountAmount || ""})`,
    `Forma de pago: ${order.paymentMethod || ""}`,
    `Estado del pago: ${order.paymentStatus || ""}`,
    `Instrucciones de pago: ${order.paymentInstructions || ""}`,
    order.bizumPhone ? `Telefono Bizum: ${order.bizumPhone}` : "",
    `${paymentDone ? "Total pagado" : "Total pendiente"}: ${order.formattedTotal || ""}`,
    "",
    "DATOS DE ENVIO",
    `Nombre: ${order.customerName || ""}`,
    `Telefono: ${order.customerPhone || ""}`,
    `Domicilio: ${order.customerAddress || ""}`,
    `Codigo postal: ${order.customerPostalCode || ""}`,
    `Ciudad: ${order.customerCity || ""}`,
    `Indicaciones: ${order.deliveryNotes || ""}`,
    `Observaciones del pedido: ${order.orderNotes || ""}`,
    order.storePickupAddress ? `Direccion de recogida: ${order.storePickupAddress}` : "",
    "",
    "Gracias por confiar en Alvera Impresion.",
    "",
    "Atentamente,",
    "Alvera Impresion"
  ].join("\r\n");

  return [
    `From: Alvera Impresion <${EMAIL_FROM}>`,
    `To: ${email}`,
    `Subject: ${ORDER_EMAIL_SUBJECT}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
    ""
  ].join("\r\n");
}

function sendSmtpMail(toEmail, message) {
  return new Promise((resolve, reject) => {
    let socket = SMTP_PORT === 465
      ? tls.connect({ host: SMTP_HOST, port: SMTP_PORT, servername: SMTP_HOST })
      : net.connect(SMTP_PORT, SMTP_HOST);
    let buffer = "";

    const fail = error => {
      socket.destroy();
      reject(error);
    };

    const readLine = () => new Promise((resolveLine, rejectLine) => {
      const onData = chunk => {
        buffer += chunk.toString("utf8");
        const lineEnd = buffer.indexOf("\r\n");
        if (lineEnd === -1) {
          return;
        }
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);
        socket.off("data", onData);
        resolveLine(line);
      };
      socket.on("data", onData);
      socket.once("error", rejectLine);
    });

    const expect = async expectedCode => {
      let line = await readLine();
      const code = line.slice(0, 3);
      while (line.charAt(3) === "-") {
        line = await readLine();
      }
      if (code !== String(expectedCode)) {
        throw new Error(`SMTP esperaba ${expectedCode} y recibio ${line}`);
      }
    };

    const send = command => {
      socket.write(`${command}\r\n`);
    };

    socket.once(SMTP_PORT === 465 ? "secureConnect" : "connect", async () => {
      try {
        await expect(220);
        send("EHLO alveraimpresion.local");
        await expect(250);

        if (SMTP_PORT !== 465) {
          send("STARTTLS");
          await expect(220);
          socket = tls.connect({ socket, servername: SMTP_HOST });
          buffer = "";
          send("EHLO alveraimpresion.local");
          await expect(250);
        }

        send("AUTH LOGIN");
        await expect(334);
        send(Buffer.from(SMTP_USER, "utf8").toString("base64"));
        await expect(334);
        send(Buffer.from(SMTP_PASS, "utf8").toString("base64"));
        await expect(235);
        send(`MAIL FROM:<${EMAIL_FROM}>`);
        await expect(250);
        send(`RCPT TO:<${toEmail}>`);
        await expect(250);
        send("DATA");
        await expect(354);
        socket.write(`${message.replace(/^\./gm, "..")}\r\n.\r\n`);
        await expect(250);
        send("QUIT");
        resolve();
      } catch (error) {
        fail(error);
      }
    });

    socket.once("error", fail);
  });
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`FotoPrints print server listening on port ${PORT}`);
  console.log(PRINTER_NAME ? `Printer: ${PRINTER_NAME}` : "Printer: default Windows printer");
  console.log(SMTP_HOST ? `SMTP: ${SMTP_HOST}:${SMTP_PORT}` : "SMTP: not configured");
});
