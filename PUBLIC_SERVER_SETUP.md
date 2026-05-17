# Servidor publico FotoPrints

La app Android esta preparada para llamar a:

`https://api.alveraimpresion.com`

Rutas usadas:

- `POST /print-order`
- `POST /save-project`
- `POST /customer-registered`
- `POST /customer-updated`
- `POST /password-recovery`
- `POST /admin-login`
- `GET /admin/customers`
- `GET /admin/orders`
- `GET /health`

## Emails automaticos

El servidor envia correos en estos casos:

- Registro de cliente: `POST /customer-registered`
- Confirmacion/resumen de pedido: `POST /print-order`
- Recuperacion de contraseña: `POST /password-recovery`

Si el SMTP no esta configurado, el servidor no pierde el email: lo guarda como archivo `.eml` dentro de la carpeta `emails/`.

## Importante

Un servidor publico en la nube no puede imprimir directamente en la impresora local de la tienda salvo que la impresora sea accesible desde internet o se instale un agente en el ordenador de la tienda.

Para produccion hay dos piezas posibles:

1. **API publica**: recibe pedidos desde la app, guarda datos y envia emails.
2. **Agente de tienda**: ordenador de la tienda que consulta los pedidos nuevos o recibe reenvios internos y los imprime en la impresora local.

Esta carpeta deja preparada la API publica.

## Variables necesarias

Copia `.env.example` y configura estas variables en tu hosting:

- `APP_API_TOKEN`: debe coincidir con el token compilado en la app.
- `AGENT_API_TOKEN`: debe coincidir con el token configurado en el agente de tienda.
- `DATA_DIR`: carpeta persistente donde se guardan clientes, pedidos, proyectos y emails pendientes.
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `EMAIL_FROM`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`

Para Alvera Impresion:

- `EMAIL_FROM=fotoprints@alveraimpresion.com`
- `SMTP_HOST=mail.alveraimpresion.com`
- `SMTP_PORT=587`
- `SMTP_USER=fotoprints@alveraimpresion.com`

En nube, deja:

`DISABLE_PRINT=1`

porque la impresion local se hara desde el ordenador de tienda, no desde el servidor publico.

## Datos persistentes en Render

Render puede borrar archivos creados dentro de la carpeta normal del servicio cuando reinicia o redespliega. Para que no se pierdan clientes ni pedidos:

1. En el servicio de Render, crea un **Disk**.
2. Usa como ruta de montaje:

`/var/data`

3. En **Environment Variables**, configura:

`DATA_DIR=/var/data`

Con eso el servidor guardara:

- `/var/data/customers.json`
- `/var/data/orders/`
- `/var/data/projects/`
- `/var/data/emails/`

## Agente de tienda

El agente esta en:

`../print-agent`

Funcionamiento:

1. El servidor publico recibe el pedido.
2. Guarda el pedido como pendiente de impresion.
3. El agente de tienda consulta `/agent/orders`.
4. Descarga el pedido, imagenes y hoja.
5. Imprime en el PC de tienda.
6. Marca el pedido como impreso en `/agent/orders/:numero/printed`.

## Proyectos guardados

Cuando el cliente elige guardar proyecto, la app llama a:

`POST /save-project`

El servidor asigna un numero:

`PR-000001`

y guarda una carpeta:

`projects/email_del_cliente/PR-000001/`

Dentro:

- `proyecto.json`
- `imagenes/`

## Dominio

Apunta un subdominio, por ejemplo:

`api.alveraimpresion.com`

al hosting donde despliegues este servidor y activa HTTPS.

## Render

Incluyo `render.yaml` para desplegarlo como Web Service en Render.

1. Sube esta carpeta a un repositorio.
2. Crea un Web Service en Render.
3. Configura las variables de entorno.
4. En DNS, apunta `api.alveraimpresion.com` al servicio.

## Prueba

Cuando este publicado:

`https://api.alveraimpresion.com/health`

debe responder:

`{"ok":true,"service":"FotoPrints print server"}`
