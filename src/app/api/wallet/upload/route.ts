import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const folder = (formData.get("folder") as string) || "wallet";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET || process.env.CLOUDINARY_UPLOAD_PRESET;

    if (!cloudName) {
      return NextResponse.json(
        { error: "Cloudinary Cloud Name is not configured in environment variables." },
        { status: 500 }
      );
    }

    // Convert File to Buffer / Base64 for Cloudinary upload
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Data = `data:${file.type || "application/octet-stream"};base64,${buffer.toString("base64")}`;

    const uploadFormData = new FormData();
    uploadFormData.append("file", base64Data);
    uploadFormData.append("folder", folder);

    // If apiKey & apiSecret are provided, sign the upload (most reliable and secure)
    if (apiKey && apiSecret) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const paramsToSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
      const signature = crypto.createHash("sha1").update(paramsToSign).digest("hex");

      uploadFormData.append("api_key", apiKey);
      uploadFormData.append("timestamp", timestamp);
      uploadFormData.append("signature", signature);
    } else if (uploadPreset) {
      // Fallback to unsigned upload preset
      uploadFormData.append("upload_preset", uploadPreset);
    } else {
      return NextResponse.json(
        { error: "Cloudinary credentials missing: please configure CLOUDINARY_API_KEY & CLOUDINARY_API_SECRET or UPLOAD_PRESET." },
        { status: 500 }
      );
    }

    const uploadRes = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
      {
        method: "POST",
        body: uploadFormData,
      }
    );

    const data = await uploadRes.json();

    if (!uploadRes.ok) {
      return NextResponse.json(
        { error: data.error?.message || "Cloudinary upload failed." },
        { status: uploadRes.status || 500 }
      );
    }

    return NextResponse.json({
      secure_url: data.secure_url,
      public_id: data.public_id,
      format: data.format,
      bytes: data.bytes,
    });
  } catch (err: any) {
    console.error("Cloudinary upload API error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error during upload." },
      { status: 500 }
    );
  }
}
