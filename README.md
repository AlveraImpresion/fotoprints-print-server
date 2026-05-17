# Servidor de impresion FotoPrints

Este servidor se ejecuta en el ordenador de la tienda. La app Android envia aqui cada pedido y este ordenador imprime la hoja en su impresora.

## Arrancar

1. En el ordenador de la tienda, abre esta carpeta:
   `print-server`
2. Haz doble clic en:
   `start-print-server.bat`
3. Deja esa ventana abierta mientras quieras recibir pedidos.

Por defecto imprime en la impresora predeterminada de Windows.

## Usar una impresora concreta

1. Abre `start-print-server-printer-example.bat`.
2. Cambia:
   `Nombre exacto de tu impresora`
   por el nombre que aparece en Windows.
3. Guarda el archivo y arrancalo.

## Direccion para la app

La app Android debe apuntar a:

`http://IP_DEL_ORDENADOR:8080/print-order`

Ejemplo:

`http://192.168.1.100:8080/print-order`

La IP debe ser la del ordenador de la tienda, no la del movil del cliente.

## Prueba rapida

Abre en el navegador del ordenador:

`http://localhost:8080/health`

Si responde, el servidor esta funcionando.

## Email de registro

Cuando un cliente se registra, la app avisa al servidor en:

`/customer-registered`

Para enviar el email desde `info@alveraimpresion.com`, arranca el servidor con datos SMTP. Puedes copiar o editar:

`start-print-server-email-example.bat`

Debes rellenar:

- `SMTP_HOST`: servidor SMTP de tu proveedor de correo.
- `SMTP_PORT`: normalmente `587` o `465`.
- `SMTP_USER`: normalmente `info@alveraimpresion.com`.
- `SMTP_PASS`: contraseña o clave de aplicacion del correo.

Si el SMTP no esta configurado, el servidor no pierde el aviso: guarda un archivo `.eml` en la carpeta `emails`.

## Administracion

El acceso de administracion se valida en el servidor con:

`/admin-login`

Puedes configurar las credenciales al arrancar con:

`start-print-server-admin-example.bat`

Variables:

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

La app no guarda la contraseña del administrador; solo pregunta al servidor si el acceso es correcto.
