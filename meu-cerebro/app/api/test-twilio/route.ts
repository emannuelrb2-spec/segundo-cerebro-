import { NextResponse } from "next/server";
import twilio from "twilio";

export async function GET() {
  try {
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    console.log("Tentando enviar para:", process.env.MY_PHONE_NUMBER);

    await client.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER,
      to: process.env.MY_PHONE_NUMBER!,
      body: "🔔 Teste de conexão: O sistema está vivo!"
    });

    return NextResponse.json({ success: true, msg: "Enviado! Cheque seu WhatsApp." });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message });
  }
}