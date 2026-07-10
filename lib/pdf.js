const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { nanoid } = require("nanoid");

const SOFFICE_BIN = process.env.SOFFICE_BIN || "soffice";
const CONVERT_TIMEOUT_MS = 60_000;

/**
 * Converte um buffer .docx em PDF usando LibreOffice headless.
 * Cada chamada usa um diretório de trabalho isolado (soffice não lida bem
 * com conversões concorrentes que compartilham o mesmo --outdir/perfil).
 */
async function convertDocxToPdf(docxBuffer) {
  const workDir = path.join(os.tmpdir(), `contrato-${nanoid()}`);
  await fs.mkdir(workDir, { recursive: true });
  const docxPath = path.join(workDir, "contrato.docx");
  const pdfPath = path.join(workDir, "contrato.pdf");

  try {
    await fs.writeFile(docxPath, docxBuffer);

    await new Promise((resolve, reject) => {
      const proc = spawn(SOFFICE_BIN, [
        "--headless",
        "--norestore",
        `-env:UserInstallation=file://${workDir}/.libreoffice`,
        "--convert-to", "pdf",
        "--outdir", workDir,
        docxPath,
      ]);

      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error("Conversão para PDF excedeu o tempo limite"));
      }, CONVERT_TIMEOUT_MS);

      let stderr = "";
      proc.stderr.on("data", (chunk) => { stderr += chunk; });
      proc.on("error", (err) => { clearTimeout(timer); reject(err); });
      proc.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`soffice saiu com código ${code}: ${stderr}`));
      });
    });

    return await fs.readFile(pdfPath);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { convertDocxToPdf };
