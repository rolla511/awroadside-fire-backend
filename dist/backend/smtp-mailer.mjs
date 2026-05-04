import crypto from "crypto";
import net from "net";
import os from "os";
import tls from "tls";

const DEFAULT_TIMEOUT_MS = 15000;

export function createSmtpMailer({
  host = "",
  port = 587,
  secure = false,
  requireStartTls = true,
  username = "",
  password = "",
  from = "",
  replyTo = "",
  localWatchdog = null
} = {}) {
  const normalizedHost = readString(host);
  const normalizedPort = Number.parseInt(String(port || 587), 10);
  const normalizedUsername = readString(username);
  const normalizedPassword = readString(password);
  const normalizedFrom = readString(from);
  const normalizedReplyTo = readString(replyTo) || normalizedFrom;

  return {
    isConfigured() {
      return Boolean(
        normalizedHost &&
        Number.isFinite(normalizedPort) &&
        normalizedPort > 0 &&
        normalizedUsername &&
        normalizedPassword &&
        normalizedFrom
      );
    },
    async sendTextEmail({ to, subject, text }) {
      const recipient = readString(to);
      const messageSubject = readString(subject);
      const messageText = readString(text);

      if (!this.isConfigured()) {
        return {
          deliveryStatus: "stored-no-transport",
          deliveredAt: null,
          transport: "smtp-not-configured",
          message: "SMTP mail transport is not configured."
        };
      }

      if (!recipient || !messageSubject || !messageText) {
        return {
          deliveryStatus: "failed",
          deliveredAt: null,
          transport: "smtp",
          message: "Recipient, subject, and message body are required."
        };
      }

      let client = null;
      try {
        client = await openSmtpConnection({
          host: normalizedHost,
          port: normalizedPort,
          secure,
          requireStartTls,
          username: normalizedUsername,
          password: normalizedPassword
        });

        await client.command(`MAIL FROM:<${normalizedFrom}>`, [250]);
        await client.command(`RCPT TO:<${recipient}>`, [250, 251]);
        await client.command("DATA", [354]);
        await client.writeRaw(buildMessage({
          from: normalizedFrom,
          to: recipient,
          replyTo: normalizedReplyTo,
          subject: messageSubject,
          text: messageText,
          host: normalizedHost
        }));
        await client.expect([250]);
        await client.command("QUIT", [221]);
        client.close();

        await localWatchdog?.record?.("subscriber-confirmation-email-sent", {
          recipientEmail: recipient,
          transport: "smtp",
          host: normalizedHost
        });

        return {
          deliveryStatus: "sent",
          deliveredAt: new Date().toISOString(),
          transport: "smtp",
          host: normalizedHost,
          port: normalizedPort,
          message: `Confirmation email sent to ${recipient}.`
        };
      } catch (error) {
        try {
          client?.close();
        } catch {
          // ignore close failure
        }

        await localWatchdog?.record?.("subscriber-confirmation-email-failed", {
          recipientEmail: recipient,
          transport: "smtp",
          host: normalizedHost,
          message: error instanceof Error ? error.message : String(error)
        });

        return {
          deliveryStatus: "failed",
          deliveredAt: null,
          transport: "smtp",
          host: normalizedHost,
          port: normalizedPort,
          message: error instanceof Error ? error.message : String(error)
        };
      }
    }
  };
}

async function openSmtpConnection({
  host,
  port,
  secure,
  requireStartTls,
  username,
  password
}) {
  const client = createLineClient({
    socket: await connectSocket({ host, port, secure })
  });

  await client.expect([220]);
  await client.command(`EHLO ${resolveEhloName()}`, [250]);

  if (!secure && requireStartTls) {
    await client.command("STARTTLS", [220]);
    await client.upgradeToTls(host);
    await client.command(`EHLO ${resolveEhloName()}`, [250]);
  }

  await client.command("AUTH LOGIN", [334]);
  await client.command(Buffer.from(username, "utf8").toString("base64"), [334]);
  await client.command(Buffer.from(password, "utf8").toString("base64"), [235]);

  return client;
}

function connectSocket({ host, port, secure }) {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({
          host,
          port,
          servername: host,
          rejectUnauthorized: true
        })
      : net.createConnection({
          host,
          port
        });

    const cleanup = () => {
      socket.removeListener("error", onError);
      socket.removeListener(secure ? "secureConnect" : "connect", onConnect);
      socket.removeListener("timeout", onTimeout);
    };

    const onConnect = () => {
      cleanup();
      resolve(socket);
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const onTimeout = () => {
      cleanup();
      socket.destroy();
      reject(new Error("SMTP connection timed out."));
    };

    socket.setTimeout(DEFAULT_TIMEOUT_MS);
    socket.once(secure ? "secureConnect" : "connect", onConnect);
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
  });
}

function createLineClient({ socket }) {
  let activeSocket = socket;
  let buffer = "";
  let currentReplyLines = [];
  let currentReplyCode = null;
  let currentReplySeparator = null;
  const pendingReplies = [];
  const completedReplies = [];

  const bindSocket = (nextSocket) => {
    activeSocket = nextSocket;
    activeSocket.setEncoding("utf8");
    activeSocket.setTimeout(DEFAULT_TIMEOUT_MS);
    activeSocket.on("data", onData);
    activeSocket.on("error", onError);
    activeSocket.on("timeout", onTimeout);
  };

  const unbindSocket = () => {
    activeSocket.removeListener("data", onData);
    activeSocket.removeListener("error", onError);
    activeSocket.removeListener("timeout", onTimeout);
  };

  const failPending = (error) => {
    while (pendingReplies.length > 0) {
      const pending = pendingReplies.shift();
      pending.reject(error);
    }
  };

  const onError = (error) => {
    failPending(error);
  };

  const onTimeout = () => {
    failPending(new Error("SMTP response timed out."));
  };

  const flushReply = () => {
    if (!currentReplyCode || currentReplySeparator !== " ") {
      return;
    }
    const reply = {
      code: Number.parseInt(currentReplyCode, 10),
      lines: [...currentReplyLines],
      message: currentReplyLines.map((line) => line.slice(4)).join("\n")
    };
    currentReplyLines = [];
    currentReplyCode = null;
    currentReplySeparator = null;

    if (pendingReplies.length > 0) {
      pendingReplies.shift().resolve(reply);
      return;
    }
    completedReplies.push(reply);
  };

  const onData = (chunk) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\r\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 2);
      const match = line.match(/^(\d{3})([ -])(.*)$/);
      if (match) {
        currentReplyCode = match[1];
        currentReplySeparator = match[2];
        currentReplyLines.push(line);
        flushReply();
      }
      newlineIndex = buffer.indexOf("\r\n");
    }
  };

  const nextReply = () => {
    if (completedReplies.length > 0) {
      return Promise.resolve(completedReplies.shift());
    }
    return new Promise((resolve, reject) => {
      pendingReplies.push({ resolve, reject });
    });
  };

  bindSocket(activeSocket);

  return {
    async command(commandText, expectedCodes) {
      await this.writeRaw(`${commandText}\r\n`);
      return this.expect(expectedCodes);
    },
    async expect(expectedCodes) {
      const reply = await nextReply();
      if (!expectedCodes.includes(reply.code)) {
        throw new Error(`SMTP ${reply.code}: ${reply.message || "Unexpected response."}`);
      }
      return reply;
    },
    writeRaw(value) {
      return new Promise((resolve, reject) => {
        activeSocket.write(value, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    async upgradeToTls(host) {
      unbindSocket();
      const tlsSocket = tls.connect({
        socket: activeSocket,
        servername: host,
        rejectUnauthorized: true
      });
      await new Promise((resolve, reject) => {
        tlsSocket.once("secureConnect", resolve);
        tlsSocket.once("error", reject);
        tlsSocket.once("timeout", () => reject(new Error("SMTP STARTTLS upgrade timed out.")));
      });
      bindSocket(tlsSocket);
    },
    close() {
      unbindSocket();
      activeSocket.end();
      activeSocket.destroy();
    }
  };
}

function buildMessage({ from, to, replyTo, subject, text, host }) {
  const messageId = `<${crypto.randomUUID()}@${host || "awroadside.local"}>`;
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Reply-To: ${replyTo}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    ...dotStuffBody(text).split("\n")
  ];
  return `${lines.join("\r\n")}\r\n.\r\n`;
}

function dotStuffBody(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\n");
}

function resolveEhloName() {
  const hostname = readString(os.hostname()).replace(/[^a-zA-Z0-9.-]/g, "");
  return hostname || "awroadside.local";
}

function readString(value) {
  return typeof value === "string" ? value.trim() : "";
}
