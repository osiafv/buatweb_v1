const {
	default: createWASocket,
	makeCacheableSignalKeyStore,
	useMultiFileAuthState,
	UseMyState,
	DisconnectReason,
	fetchLatestBaileysVersion,
	getContentType,
	generateForwardMessageContent,
	generateWAMessageFromContent,
	generateMessageID,
	prepareWAMessageMedia,
	downloadContentFromMessage,
	makeInMemoryStore,
	jidDecode,
	proto,
	delay,
} = require("@whiskeysockets/baileys");
const log = (pino = require("pino"));
const { session } = { session: "baileys_auth_info" };
const { Boom } = require("@hapi/boom");
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");
const express = require("express");
const fileUpload = require("express-fileupload");
const cors = require("cors");
const bodyParser = require("body-parser");
const app = require("express")();
// enable files upload
app.use(
	fileUpload({
		createParentPath: true,
	}),
);

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
const server = require("http").createServer(app);
const io = require("socket.io")(server);
const port = process.env.PORT || 8000;
const qrcode = require("qrcode");

app.use("/assets", express.static(__dirname + "/client/assets"));

app.get("/scan", (req, res) => {
	res.sendFile("./client/server.html", {
		root: __dirname,
	});
});

app.get("/", (req, res) => {
	res.sendFile("./client/index.html", {
		root: __dirname,
	});
});
//fungsi suara capital
function capital(textSound) {
	const arr = textSound.split(" ");
	for (var i = 0; i < arr.length; i++) {
		arr[i] = arr[i].charAt(0).toUpperCase() + arr[i].slice(1);
	}
	const str = arr.join(" ");
	return str;
}
const store = makeInMemoryStore({
	logger: pino().child({ level: "silent", stream: "store" }),
});

let sock;
let qr;
let soket;

async function connectToWhatsApp() {
	const { state, saveCreds } = await useMultiFileAuthState("baileys_auth_info");
	let { version, isLatest } = await fetchLatestBaileysVersion();
	// sock = makeWASocket({
	//     printQRInTerminal: true,
	//     auth: state,
	//     logger: log({ level: "silent" }),
	//     version,
	//     shouldIgnoreJid: jid => isJidBroadcast(jid),
	// });
	const sock = createWASocket({
		printQRInTerminal: true,
		syncFullHistory: true,
		markOnlineOnConnect: true,
		connectTimeoutMs: 60000,
		defaultQueryTimeoutMs: 0,
		keepAliveIntervalMs: 10000,
		generateHighQualityLinkPreview: true,
		patchMessageBeforeSending: (message) => {
			const hasButtons = !!(
				message.buttonsMessage ||
				message.templateMessage ||
				message.listMessage
			);
			if (hasButtons) {
				message = {
					viewOnceMessage: {
						message: {
							messageContextInfo: {
								deviceListMetadataVersion: 2,
								deviceListMetadata: {},
							},
							...message,
						},
					},
				};
			}
			return message;
		},
		version,
		browser: ["WEB CPANEL", "Chrome", "20.0.04"],
		logger: pino({
			level: "fatal",
		}),
		auth: state,
	});
	store.bind(sock.ev);
	sock.multi = true;
	sock.ev.on("connection.update", async (update) => {
		//console.log(update);
		const { connection, lastDisconnect } = update;
		if (connection === "close") {
			let reason = new Boom(lastDisconnect.error).output.statusCode;
			if (reason === DisconnectReason.badSession) {
				console.log(
					`Bad Session File, Please Delete ${session} and Scan Again`,
				);
				sock.logout();
			} else if (reason === DisconnectReason.connectionClosed) {
				console.log("Connection closed, reconnecting....");
				connectToWhatsApp();
			} else if (reason === DisconnectReason.connectionLost) {
				console.log("Connection Lost from Server, reconnecting...");
				connectToWhatsApp();
			} else if (reason === DisconnectReason.connectionReplaced) {
				console.log(
					"Connection Replaced, Another New Session Opened, Please Close Current Session First",
				);
				sock.logout();
			} else if (reason === DisconnectReason.loggedOut) {
				console.log(
					`Device Logged Out, Please Delete ${session} and Scan Again.`,
				);
				sock.logout();
			} else if (reason === DisconnectReason.restartRequired) {
				console.log("Restart Required, Restarting...");
				connectToWhatsApp();
			} else if (reason === DisconnectReason.timedOut) {
				console.log("Connection TimedOut, Reconnecting...");
				connectToWhatsApp();
			} else {
				sock.end(`Unknown DisconnectReason: ${reason}|${lastDisconnect.error}`);
			}
		} else if (connection === "open") {
			console.log("opened connection");
			let getGroups = await sock.groupFetchAllParticipating();
			let groups = Object.values(await sock.groupFetchAllParticipating());
			//console.log(groups);
			for (let group of groups) {
				console.log(
					"id_group: " + group.id + " || Nama Group: " + group.subject,
				);
			}
			return;
		}
		if (update.qr) {
			qr = update.qr;
			updateQR("qr");
		} else if ((qr = undefined)) {
			updateQR("loading");
		} else {
			if (update.connection === "open") {
				updateQR("qrscanned");
				return;
			}
		}
	});
	sock.ev.on("creds.update", saveCreds);
	sock.ev.on("messages.upsert", async ({ messages, type }) => {
		//console.log(messages);
		// try {
		//     const msg = messageUpdate.messages[0];
		//     if (!msg.message) {
		//         return;
		//     }
		//     msg.message = Object.keys(msg.message)[0] === "ephemeralMessage" ? msg.message.ephemeralMessage.message : msg.message;
		//     if (msg.key && msg.key.remoteJid === "status@broadcast") {
		//         return;
		//     }
		//     if (!msg.key.fromMe && messageUpdate.type === "notify") {
		//         return;
		//     }
		//     if (msg.key.id.startsWith('') && msg.key.id.length === 16) {
		//         return;
		//     }
		//     if (msg.key.id.startsWith("BAE5")) {
		//         return;
		//     }
		//     const m = smsg(sock, msg, store);
		// } catch (error) {
		//     console.log(error);
		// }
		if (type === "notify") {
			const msg = messages[0];
			if (!msg.key.fromMe) {
				//nowa dari pengirim pesan sebagai id
				const noWa = msg.key.remoteJid;

				await sock.readMessages([msg.key]);

				//tentukan jenis pesan berbentuk text
				const pesan = msg.message.conversation;
				//kecilkan semua pesan yang masuk lowercase
				const pesanMasuk = pesan.toLowerCase();

				if (!msg.key.fromMe && pesanMasuk === "ping") {
					await sock.sendMessage(
						noWa,
						{ text: noWa + " Pong" },
						{ quoted: msg },
					);
				}
			}
		}
	});
	const verificationCodes = {}; // Penyimpanan sementara untuk kode yang dihasilkan
	const CODE_EXPIRATION_TIME = 5 * 60 * 1000; // 5 menit

	// // API untuk mendapatkan kode acak 4-6 digit dan menyimpannya sementara
	// app.get("/get-code", (req, res) => {
	// 	const codeLength = Math.floor(Math.random() * 3) + 4; // 4 hingga 6 digit
	// 	const randomCode = Math.floor(Math.pow(10, codeLength - 1) + Math.random() * (Math.pow(10, codeLength) - Math.pow(10, codeLength - 1))).toString();
	// 	const index = Date.now(); // Gunakan timestamp sebagai index unik

	// 	// Simpan kode dengan timestamp
	// 	verificationCodes[index] = { code: codeString, expiresAt: Date.now() + CODE_EXPIRATION_TIME };

	// 	res.json({ index, kode: randomCode }); // Kirim index agar bisa diverifikasi nanti
	// });

	// API untuk mengirim kode verifikasi ke WhatsApp
	app.post("/send-code", async (req, res) => {
		const { phoneNumber } = req.body;

		// Konversi index ke angka untuk menghindari error;
		if (!phoneNumber) {
			return res
				.status(400)
				.json({ error: "Nomor WhatsApp yang valid diperlukan!" });
		}

		// Buat kode baru
		const codeLength = Math.floor(Math.random() * 3) + 4; // 4 hingga 6 digit
		const code = Math.floor(
			Math.pow(10, codeLength - 1) +
				Math.random() *
					(Math.pow(10, codeLength) - Math.pow(10, codeLength - 1)),
		).toString();
		const index = Date.now(); // Gunakan timestamp sebagai index unik

		// Simpan kode dengan masa berlaku
		verificationCodes[index] = {
			code,
			expiresAt: Date.now() + CODE_EXPIRATION_TIME,
		};

		const message = `${code} adalah Kode verifikasi Anda`;
		const codenya = `${code}`; // Ini string, jadi aman

		try {
			// await sock.sendMessage(`${phoneNumber}@s.whatsapp.net`, { text: message });
			const jid = `${phoneNumber}@s.whatsapp.net`; // Ganti dengan JID tujuan

			const messageContent = {
				viewOnceMessage: {
					message: {
						messageContextInfo: {
							deviceListMetadata: {},
							deviceListMetadataVersion: 2,
						},
						interactiveMessage: proto.Message.InteractiveMessage.fromObject({
							body: proto.Message.InteractiveMessage.Body.create({
								text: message,
							}),
							footer: proto.Message.InteractiveMessage.Footer.create({
								text: "Kode ini kedaluwarsa dalam 5 menit",
							}),
							header: proto.Message.InteractiveMessage.Header.create({
								hasMediaAttachment: false,
							}),
							nativeFlowMessage:
								proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
									buttons: [
										{
											name: "cta_copy",
											buttonParamsJson: `{
                                        "display_text": "Salin kode",
                                        "id": ${codenya},
                                        "copy_code": ${codenya}
                                    }`,
										},
									],
								}),
						}),
					},
				},
			};

			const msg = generateWAMessageFromContent(jid, messageContent, {
				userJid: sock.user.id, // Pastikan ada user JID
				timestamp: new Date(), // Menambahkan timestamp
			});

			sock.relayMessage(jid, msg.message, {
				messageId: msg.key.id,
			});
			res.json({
				success: true,
				index,
				message: "Kode verifikasi dikirim ke WhatsApp!",
			});
		} catch (error) {
			console.error("Error sending WhatsApp message:", error);
			res
				.status(500)
				.json({ error: "Gagal mengirim pesan", details: error.message });
		}
	});

	// API untuk verifikasi kode
	app.post("/verify-code", (req, res) => {
		const { index, code } = req.body;

		// Cek apakah index valid dan masih berlaku
		if (!verificationCodes[index]) {
			return res.json({
				success: false,
				message: "Kode tidak ditemukan atau sudah kedaluwarsa!",
			});
		}

		const storedData = verificationCodes[index];

		// Cek apakah kode masih berlaku
		if (Date.now() > storedData.expiresAt) {
			delete verificationCodes[index]; // Hapus kode yang kadaluarsa
			return res.json({ success: false, message: "Kode sudah kedaluwarsa!" });
		}

		// Cek apakah kode cocok
		if (storedData.code === code) {
			res.json({
				success: true,
				message: "Verifikasi berhasil! Pendaftaran sukses.",
			});
		} else {
			res.json({ success: false, message: "Kode salah! Silakan coba lagi." });
		}
	});

	app.post("/send-grub", async (req, res) => {
		const { gmbrnya, desc, imagee } = req.body; // idgrubnya harus berupa array

		idgrubnya = [
			"120363390721446244@g.us",
			"120363408604028416@g.us",
			"120363392500574290@g.us",
			"120363394223609294@g.us",
			"120363410208252797@g.us",
		];
		try {
			for (const grubnya of idgrubnya) {
				if (gmbrnya === true) {
					sock.sendMessage(grubnya, { text: desc });
				} else {
					sock.sendMessage(grubnya, {
						image: { url: `https://rkyglobal.web.id/public/img/${imagee}` },
						caption: desc,
					});
				}
				await new Promise((resolve) => setTimeout(resolve, 200)); // Tambahkan delay 500ms agar tidak terkena limit
			}

			res.json({
				success: true,
				message: "Pemberitahuan dikirim ke semua grup WhatsApp!",
			});
		} catch (error) {
			res.status(500).json({ error: "Gagal mengirim pesan" });
		}
	});
}

io.on("connection", async (socket) => {
	soket = socket;
	// console.log(sock)
	if (isConnected) {
		updateQR("connected");
	} else if (qr) {
		updateQR("qr");
	}
});

// functions
const isConnected = () => {
	return sock.user;
};

const updateQR = (data) => {
	switch (data) {
		case "qr":
			qrcode.toDataURL(qr, (err, url) => {
				soket?.emit("qr", url);
				soket?.emit("log", "QR Code received, please scan!");
			});
			break;
		case "connected":
			soket?.emit("qrstatus", "./assets/check.svg");
			soket?.emit("log", "WhatsApp terhubung!");
			break;
		case "qrscanned":
			soket?.emit("qrstatus", "./assets/check.svg");
			soket?.emit("log", "QR Code Telah discan!");
			break;
		case "loading":
			soket?.emit("qrstatus", "./assets/loader.gif");
			soket?.emit("log", "Registering QR Code , please wait!");
			break;
		default:
			break;
	}
};

function smsg(sock, message, store) {
	if (!message) {
		return message;
	}
	let messageInfo = proto.WebMessageInfo;
	if (message.key) {
		message.id = message.key.id;
		message.isBaileys =
			message.id.startsWith("BAE5") && message.id.length === 10;
		message.chat = message.key.remoteJid;
		message.fromMe = message.key.fromMe;
		message.isGroup = message.chat.endsWith("@g.us");
		message.sender = sock.decodeJid(
			(message.fromMe && sock.user.id) ||
				message.participant ||
				message.key.participant ||
				message.chat ||
				"",
		);
		if (message.isGroup) {
			message.participant = sock.decodeJid(message.key.participant) || "";
		}
	}
	if (message.message) {
		message.mtype = getContentType(message.message);
		message.msg =
			message.mtype === "viewOnceMessage"
				? message.message[message.mtype].message[
						getContentType(message.message[message.mtype].message)
					]
				: message.message[message.mtype];
		message.body =
			message.message.conversation ||
			message.msg.caption ||
			message.msg.text ||
			(message.mtype === "listResponseMessage" &&
				message.msg.singleSelectReply.selectedRowId) ||
			(message.mtype === "buttonsResponseMessage" &&
				message.msg.selectedButtonId) ||
			(message.mtype === "viewOnceMessage" && message.msg.caption) ||
			message.text;
		let quotedMessage = (message.quoted = message.msg.contextInfo
			? message.msg.contextInfo.quotedMessage
			: null);
		message.mentionedJid = message.msg.contextInfo
			? message.msg.contextInfo.mentionedJid
			: [];
		if (message.quoted) {
			let quotedType = getContentType(quotedMessage);
			message.quoted = message.quoted[quotedType];
			if (["productMessage"].includes(quotedType)) {
				quotedType = getContentType(message.quoted);
				message.quoted = message.quoted[quotedType];
			}
			if (typeof message.quoted === "string") {
				message.quoted = {
					text: message.quoted,
				};
			}
			message.quoted.mtype = quotedType;
			message.quoted.id = message.msg.contextInfo.stanzaId;
			message.quoted.chat = message.msg.contextInfo.remoteJid || message.chat;
			message.quoted.isBaileys = message.quoted.id
				? message.quoted.id.startsWith("BAE5") &&
					message.quoted.id.length === 10
				: false;
			message.quoted.sender = sock.decodeJid(
				message.msg.contextInfo.participant,
			);
			message.quoted.fromMe =
				message.quoted.sender === sock.decodeJid(sock.user.id);
			message.quoted.text =
				message.quoted.text ||
				message.quoted.caption ||
				message.quoted.conversation ||
				message.quoted.contentText ||
				message.quoted.selectedDisplayText ||
				message.quoted.title ||
				"";
			message.quoted.mentionedJid = message.msg.contextInfo
				? message.msg.contextInfo.mentionedJid
				: [];
			message.quoted.getQuotedObj = message.quoted.getQuotedMessage =
				async () => {
					if (!message.quoted.id) {
						return false;
					}
					let quotedMessageData = await store.loadMessage(
						message.chat,
						message.quoted.id,
						sock,
					);
					return exports.smsg(sock, quotedMessageData, store);
				};
			let fakeObj = (message.quoted.fakeObj = messageInfo.fromObject({
				key: {
					remoteJid: message.quoted.chat,
					fromMe: message.quoted.fromMe,
					id: message.quoted.id,
				},
				message: quotedMessage,
				...(message.isGroup
					? {
							participant: message.quoted.sender,
						}
					: {}),
			}));
			message.quoted["delete"] = () =>
				sock.sendMessage(message.quoted.chat, {
					delete: fakeObj.key,
				});
			message.quoted.copyNForward = (to, readViewOnce = false, options = {}) =>
				sock.copyNForward(to, fakeObj, readViewOnce, options);
			message.quoted.download = () => sock.downloadMediaMessage(message.quoted);
		}
	}
	if (message.msg.url) {
		message.download = () => sock.downloadMediaMessage(message.msg);
	}
	message.text =
		message.msg.text ||
		message.msg.caption ||
		message.message.conversation ||
		message.msg.contentText ||
		message.msg.selectedDisplayText ||
		message.msg.title ||
		"";
	message.reply = (response, chatId = message.chat, options = {}) =>
		Buffer.isBuffer(response)
			? sock.sendMedia(chatId, response, "file", "", message, {
					...options,
				})
			: sock.sendText(chatId, response, message, {
					...options,
				});
	message.copy = () =>
		exports.smsg(sock, messageInfo.fromObject(messageInfo.toObject(message)));
	message.copyNForward = (
		to = message.chat,
		readViewOnce = false,
		options = {},
	) => sock.copyNForward(to, message, readViewOnce, options);
	return message;
}
connectToWhatsApp().catch((err) => console.log("unexpected error: " + err)); // catch any errors
server.listen(port, () => {
	console.log("Server Berjalan pada Port : " + port);
});
