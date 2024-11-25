import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import express from "express";
import cors from "cors";
import QRCode from "qrcode";
import http from "node:http";
import { Server } from "socket.io";
import QR from "./classes/qr";
import crypto from "crypto";

const HMAC_KEY =
  "64544abe95ab9afb8929c22112cea5bd9914c1cf102b92945490a350b3befff4";
const PORT = 3003;
const app = express();
app.use(express.json());
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const session = "auth_state";
let sock: ReturnType<typeof makeWASocket> | null;
const dynamicQR = new QR();

const connectToWhatsAppSocket = async () => {
  const { state, saveCreds } = await useMultiFileAuthState(session);

  sock = makeWASocket({
    syncFullHistory: false,
    markOnlineOnConnect: false,
    printQRInTerminal: true,
    auth: state,
  });

  sock?.ev.on("creds.update", saveCreds);

  sock?.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    dynamicQR.qr = qr || "";
    if (connection === "close") {
      const reason = new Boom(lastDisconnect?.error).output.statusCode;
      if (reason === DisconnectReason.badSession) {
        console.log(
          `Archivo de sesión corrupto, por favor elimine la carpeta ${session} y escaneé de nuevo.`
        );
        sock?.logout();
      } else if (reason === DisconnectReason.connectionClosed) {
        console.log("Conexión cerrada, reconectando....");
        connectToWhatsAppSocket();
      } else if (reason === DisconnectReason.connectionLost) {
        console.log("Conexión perdida con el servidor, reconectando...");
        connectToWhatsAppSocket();
      } else if (reason === DisconnectReason.connectionReplaced) {
        console.log(
          "Conexión reemplazada. Hay una nueva sesión abierta, cierre la sesión actual."
        );
        sock?.logout();
      } else if (reason === DisconnectReason.loggedOut) {
        console.log(
          `Dispositivo cerrado, por favor elimine la carpeta ${session} y escaneé de nuevo.`
        );
        io.emit("status", "DESCONECTADO");
        sock?.logout();
      } else if (reason === DisconnectReason.restartRequired) {
        console.log("Se requiere reinicio, reiniciando...");
        connectToWhatsAppSocket();
      } else if (reason === DisconnectReason.timedOut) {
        console.log("Se agotó el tiempo de la conexión, conectando...");
        connectToWhatsAppSocket();
      } else {
        sock?.end(
          new Error(
            `Motivo de desconexión desconocido: ${reason}|${lastDisconnect?.error}`
          )
        );
      }
    } else if (connection === "open") {
      console.log("Conexión abierta.");
      if (isConnected()) {
        io.emit("status", "CONECTADO");
      } else {
        io.emit("status", "DESCONECTADO");
      }
    }
  });
};

const isConnected = () => {
  return sock?.user ? true : false;
};

const removePlusSign = (number: string) => {
  if (typeof number === "string" && number.startsWith("+")) {
    return number.slice(1);
  }

  return number;
};

connectToWhatsAppSocket().catch((err) =>
  console.error("Error desconocido: " + err)
);

app.get("/ping", async (_req, res) => {
  return res.status(200).send();
});

app.get("/estado", async (_req, res) => {
  if (isConnected()) {
    return res.status(200).json({
      status: "CONECTADO",
    });
  } else {
    return res.status(200).json({
      status: "DESCONECTADO",
    });
  }
});

app.get("/qr", async (_req, res) => {
  if (isConnected()) {
    return res.status(200).json({
      status: "CONECTADO",
    });
  } else {
    QRCode.toDataURL(dynamicQR.qr, (_err, url) => {
      io.emit("qr", url);
      io.emit("status", "DESCONECTADO");
    });
  }
});

app.post("/enviar", async (req, res) => {
  try {
    const datos = req.body.datos as {
      telefono: string;
      contenido: string;
    };

    const hash = req.body.hash;

    if (!hash || hash === "") {
      return res.status(400).send();
    }

    const thisHash = crypto
      .createHmac("sha256", HMAC_KEY)
      .update(JSON.stringify(datos))
      .digest("hex");

    if (hash !== thisHash) {
      return res.status(403).send();
    }

    if (isConnected()) {
      const id = removePlusSign(datos.telefono) + "@s.whatsapp.net";
      const result = await sock?.sendMessage(id, {
        text: datos.contenido,
      });

      if (result) {
        return res.status(200).json({
          status: "EXITO",
          result: result,
        });
      }
    } else {
      return res.status(200).json({
        status: "DESCONECTADO",
      });
    }
  } catch {
    return res.status(500).send();
  }
});

dynamicQR.on("change", (value) => {
  if (!isConnected()) {
    QRCode.toDataURL(value, (_err, url) => {
      io.emit("qr", url);
      io.emit("status", "DESCONECTADO");
    });
  } else {
    io.emit("status", "CONECTADO");
  }
});

server.listen(PORT, () =>
  console.log(`Servicio de mensajero abierto en el puerto ${PORT}`)
);

export {};
