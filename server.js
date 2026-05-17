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
const ORDERS_DIR = path.join(__dirname, "orders");
const PROJECTS_DIR = path.join(__dirname, "projects");
const EMAILS_DIR = path.join(__dirname, "emails");
const CUSTOMERS_FILE = path.join(__dirname, "customers.json");
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

fs.mkdirSync(ORDERS_DIR, { recursive: true });
fs.mkdirSync(PROJECTS_DIR, { recursive: true });
fs.mkdirSync(EMAILS_DIR, { recursive: true });
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

function buildTicket(order) {
  return [
    "FOTOPRINTS",
    "==============================",
    `Pedido: ${order.orderNumber || ""}`,
    `Fecha: ${order.createdAt || ""}`,
    "",
    "DATOS DEL CLIENTE",
    "------------------------------",
    `Nombre: ${order.customerName || ""}`,
    `Email: ${order.customerEmail || ""}`,
    `Telefono: ${order.customerPhone || ""}`,
    `Domicilio: ${order.customerAddress || ""}`,
    `Codigo postal: ${order.customerPostalCode || ""}`,
    `Ciudad: ${order.customerCity || ""}`,
    `Indicaciones: ${order.deliveryNotes || ""}`,
    `Observaciones del pedido: ${order.orderNotes || ""}`,
    "",
    "DATOS DEL PEDIDO",
    "------------------------------",
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
    `Total: ${order.formattedTotal || ""}`,
    "",
    "==============================",
    ""
  ].join("\r\n");
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

  if (request.method === "GET" && request.url === "/admin/customers") {
    sendJson(response, 200, { ok: true, customers: readRegisteredCustomers() });
    return;
  }

  if (request.method === "GET" && request.url === "/admin/orders") {
    sendJson(response, 200, { ok: true, orders: readStoredOrders() });
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

  if (request.method !== "POST" || request.url !== "/print-order") {
    sendJson(response, 404, { ok: false, error: "Ruta no encontrada" });
    return;
  }

  try {
    const body = await readRequestBody(request);
    const order = JSON.parse(body);
    saveRegisteredCustomer({
      name: order.customerName,
      email: order.customerEmail,
      phone: order.customerPhone,
      address: order.customerAddress,
      postalCode: order.customerPostalCode,
      city: order.customerCity,
      deliveryNotes: order.deliveryNotes
    });
    const orderNumber = cleanFileName(order.orderNumber);
    const orderDir = path.join(ORDERS_DIR, orderNumber);
    const imagesDir = path.join(orderDir, "imagenes");
    const jsonPath = path.join(orderDir, "pedido.json");
    const ticketPath = path.join(orderDir, "hoja_pedido.txt");

    fs.mkdirSync(imagesDir, { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(buildStoredOrder(order), null, 2), "utf8");
    fs.writeFileSync(ticketPath, buildTicket(order), "utf8");
    saveOrderImages(order, imagesDir);
    fs.writeFileSync(path.join(orderDir, "pending-print.json"), JSON.stringify({
      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
      receivedAt: new Date().toISOString()
    }, null, 2), "utf8");

    const printResult = await printTicket(ticketPath);
    const emailResult = await sendOrderConfirmationEmail(order);
    sendJson(response, 200, {
      ok: true,
      orderNumber: order.orderNumber,
      printResult,
      emailResult
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
  if (!fs.existsSync(orderPath) || !fs.existsSync(ticketPath)) {
    return null;
  }

  return {
    order: JSON.parse(fs.readFileSync(orderPath, "utf8")),
    ticketText: fs.readFileSync(ticketPath, "utf8"),
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
