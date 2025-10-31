import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import { execSync } from "child_process";
import multer from "multer";
import fs from "fs";
import path from "path";
import os from "os";

const app = express();
const PORT = 3000;
const TOKEN = "sk_10921.ytFcmj7MvF6ZVKoEKmL9P2aAixNO8fRV";

app.use(cors({ origin: "*" }));

// Middleware de diagnóstico para /upload-pdf: registra intentos de subida
app.use('/upload-pdf', (req, res, next) => {
  try {
    const origin = req.headers['origin'] || req.headers['referer'] || '-';
    const contentLength = req.headers['content-length'] || '-';
    console.log(`Incoming /upload-pdf request from ${req.ip} - Origin: ${origin} - Content-Length: ${contentLength}`);
  } catch (e) {
    console.error('Error logging upload attempt:', e);
  }
  next();
});

// --- Configuración para guardar PDFs subidos, crear la carpeta pdfs para luego crear un enlace simbólico ---
const PDF_SAVE_DIR = process.env.PDF_SAVE_DIR || path.join(os.homedir(), 'Descargas', 'pdfs', 'google-pdfs');

// Asegurarse de que el directorio exista y sea escribible
try {
  // Crear el directorio si no existe
  fs.mkdirSync(PDF_SAVE_DIR, { recursive: true });
  
  // Verificar permisos de escritura
  fs.accessSync(PDF_SAVE_DIR, fs.constants.W_OK);
  
  console.log(`Directorio para PDFs configurado correctamente en: ${PDF_SAVE_DIR}`);
} catch (err) {
  console.error(`Error crítico: No se puede acceder o escribir en el directorio de PDFs: ${PDF_SAVE_DIR}`);
  console.error('Detalles del error:', err);
  
  // Intentar crear en una ubicación alternativa si falla
  const fallbackDir = path.join(os.tmpdir(), 'pdfs-backup');
  try {
    fs.mkdirSync(fallbackDir, { recursive: true });
    console.log(`Se usará el directorio alternativo: ${fallbackDir}`);
    PDF_SAVE_DIR = fallbackDir;
  } catch (fallbackErr) {
    console.error('Error crítico: Tampoco se pudo crear el directorio alternativo:', fallbackErr);
  }
}

const storage = multer.memoryStorage();
const upload = multer({ storage });

// Función para obtener IP usando tu comando Linux
function obtenerIPLinux() {
  try {
    const ip = execSync("hostname -I | awk '{print $1}'").toString().trim();
    return ip;
  } catch (error) {
    console.error("Error obteniendo IP:", error.message);
    return null;
  }
}

// Endpoint para consultar RUC
app.get("/api/ruc/:ruc", async (req, res) => {
  const ruc = req.params.ruc;
  
  if (!/^\d{11}$/.test(ruc)) {
    return res.status(400).json({ error: "El RUC debe tener 11 dígitos" });
  }
  
  try {
    const response = await fetch(`https://api.decolecta.com/v1/sunat/ruc?numero=${ruc}`, {
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${TOKEN}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Error en la API: ${response.status}`);
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Error consultando RUC:", error);
    res.status(500).json({ error: "Error en la consulta del RUC" });
  }
});

// Endpoint para consultar DNI
app.get("/api/dni/:dni", async (req, res) => {
  const dni = req.params.dni;
  
  if (!/^\d{8}$/.test(dni)) {
    return res.status(400).json({ error: "El DNI debe tener 8 dígitos" });
  }
  
  try {
    const response = await fetch(`https://api.decolecta.com/v1/reniec/dni?numero=${dni}`, {
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${TOKEN}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Error en la API: ${response.status}`);
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Error consultando DNI:", error);
    res.status(500).json({ error: "Error en la consulta del DNI" });
  }
});

// Endpoint para recibir y guardar PDF - VERSIÓN FUNCIONAL
app.post('/upload-pdf', (req, res) => {
  try {
    // Verificar que sea multipart/form-data
    if (!req.is('multipart/form-data')) {
      return res.status(400).json({ error: "Se esperaba multipart/form-data" });
    }

    // Usar multer sin .single() ya que manejamos FormData
    upload.any()(req, res, function(err) {
      if (err) {
        console.error('Error en multer:', err);
        return res.status(500).json({ error: "Error al procesar el archivo: " + err.message });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: "No se recibió archivo PDF" });
      }

      const file = req.files[0];
      const numeroExpediente = req.body.numeroExpediente;

      console.log('Archivo recibido:', file.originalname);
      console.log('Número expediente:', numeroExpediente);
      console.log('Tamaño archivo:', file.size);

      // Validar que sea PDF
      if (file.mimetype !== 'application/pdf') {
        return res.status(400).json({ error: "El archivo debe ser PDF" });
      }

      // Guardar con nombre original
      const fileName = file.originalname;
      const filePath = path.join(PDF_SAVE_DIR, fileName);

      // Verificar que el directorio existe antes de intentar escribir
      try {
        // Verificar que el directorio existe y es escribible
        fs.accessSync(PDF_SAVE_DIR, fs.constants.W_OK);

        fs.writeFile(filePath, file.buffer, (err) => {
          if (err) {
            console.error('Error al guardar PDF:', err);
            return res.status(500).json({ 
              error: "Error al guardar el archivo",
              details: err.message,
              path: filePath
            });
          }

          console.log('PDF guardado exitosamente en:', filePath);
          res.json({ 
            success: true, 
            message: "PDF guardado correctamente",
            path: filePath,
            fileName: fileName
          });
        });
      } catch (err) {
        console.error('Error al acceder al directorio de PDFs:', err);
        return res.status(500).json({ 
          error: "Error de acceso al directorio",
          details: err.message,
          directory: PDF_SAVE_DIR
        });
      }
    });
  } catch (error) {
    console.error('Error general en /upload-pdf:', error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Endpoint para recibir y guardar PDF. Espera FormData con campo 'pdf'.
// app.post('/upload-pdf', upload.single('pdf'), (req, res) => {
//   try {
//     if (!req.file) {
//       return res.status(400).json({ error: "No se recibió archivo PDF en el campo 'pdf'" });
//     }

//     // Tomar el nombre original enviado por el cliente si existe
//     let originalName = req.file.originalname || 'document.pdf';
//     // Sanitizar para evitar rutas/char peligrosos
//     originalName = path.basename(originalName);
//     originalName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');

//     const savePath = path.join(PDF_SAVE_DIR, originalName);

//     fs.writeFileSync(savePath, req.file.buffer);

//     console.log(`PDF guardado: ${savePath}`);
//     return res.json({ ok: true, path: savePath, filename: originalName });
//   } catch (err) {
//     console.error('Error guardando PDF:', err);
//     return res.status(500).json({ error: 'Error al guardar el archivo' });
//   }
// });

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
  const ipLAN = obtenerIPLinux();
  
  console.log("🚀 Servidor de Consultas RUC/DNI corriendo");
  console.log(`   Local: http://${ipLAN}:${PORT}`);
  
  if (ipLAN) {
    console.log(`   Red LAN: http://${ipLAN}:${PORT}`);
  }
  
  console.log("\n📚 Endpoints:");
  console.log(`   • RUC: GET /api/ruc/:ruc`);
  console.log(`   • DNI: GET /api/dni/:dni\n`);
});


