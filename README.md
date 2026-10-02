# SubSync AI Studio (BYOK Open-Source Edition)

> **Precision AI Subtitle, Captioning & Video/Audio Smart Clip Repurposing Studio**  
> 100% Free • Open-Source • Bring Your Own Key (BYOK) • Multi-Platform (Web, Desktop, Mobile)

---

## 🌟 Overview

SubSync AI Studio is a speech-synchronized subtitle generation, video editor, and automated highlight clip cutting studio powered by the Google Gemini API. It divisionally cuts, accurately transcribes, and synchronizes subtitles (SRT/VTT) with frame-accurate speech onset times.

### 🔒 Privacy & Architecture: Bring Your Own Key (BYOK)
- **Zero API Key Leakage:** There is **NO** developer key embedded or stored anywhere on remote servers.
- **Client-Side Storage:** Every user enters their own Gemini API key. Keys are saved locally on the user's own device in `localStorage`.
- **Zero Central Server Tracking:** Your keys, files, and transcriptions are strictly processed locally and never stored in any external database.

---

## 🔑 How to Get a Free Gemini API Key

Google AI Studio provides a free tier for Gemini models:

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Sign in with your Google account.
3. Click on the blue **"Create API key"** (or **"Get API key"**) button.
4. Select or create a Google Cloud project to associate with your key.
5. Copy your new API key (starts with `AIzaSy...`).

---

## ⚙️ How to Configure Your API Key in SubSync

### Method 1: In the Application Interface (Recommended)
1. Open SubSync AI Studio in your browser or application.
2. Click the **"Gemini API Settings"** button in the top navigation bar or navigate to **Settings**.
3. Paste your Gemini API key in the input box.
4. Click **"Test Connection"** to verify that your key is active.
5. Click **"Save API Key"**. Your key is securely stored in your device's browser/app storage.

### Method 2: Local Environment Variable (Optional for Server Hosts)
If you are hosting your own local instance or Docker container:
1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` and insert your key:
   ```env
   GEMINI_API_KEY=AIzaSyYourKeyHere...
   ```

---

## 🚀 How to Run the Project Locally

### Prerequisites
- [Node.js](https://nodejs.org/) (version 18 or higher recommended)
- `npm` or `yarn`

### Installation & Launch

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/subsync-ai-studio.git
   cd subsync-ai-studio
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```

4. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

---

## 🖥️ How to Build the Desktop Application (Windows / macOS / Linux)

SubSync is structured so it can be packaged as a native desktop application using [Electron](https://www.electronjs.org/).

### Steps:
1. **Build the production web bundle:**
   ```bash
   npm run build:electron
   ```

2. **Install Electron and Electron Builder (if not already installed):**
   ```bash
   npm install --save-dev electron electron-builder
   ```

3. **Package the executable for your OS:**
   - **For Windows (EXE installer & Portable):**
     ```bash
     npx electron-builder --win
     ```
   - **For macOS (DMG & App bundle):**
     ```bash
     npx electron-builder --mac
     ```
   - **For Linux (AppImage & deb):**
     ```bash
     npx electron-builder --linux
     ```
4. Output installers will be generated inside the `dist/` or `out/` folder.

---

## 📱 How to Build the Android APK (Capacitor)

The codebase is pre-configured with `capacitor.config.ts` for quick packaging to Android:

### Steps:
1. **Build the production web assets:**
   ```bash
   npm run build:mobile
   ```

2. **Install Capacitor CLI and Android platform:**
   ```bash
   npm install @capacitor/core
   npm install --save-dev @capacitor/cli @capacitor/android
   ```

3. **Initialize and sync the Android project:**
   ```bash
   npx cap add android
   npx cap sync
   ```

4. **Open in Android Studio:**
   ```bash
   npx cap open android
   ```

5. **Build APK / App Bundle in Android Studio:**
   - In Android Studio, go to **Build** ➔ **Build Bundle(s) / APK(s)** ➔ **Build APK(s)**.
   - The compiled `.apk` will be in `android/app/build/outputs/apk/debug/`.

---

## 🛠️ Tech Stack & Architecture

- **Frontend:** React 19, TypeScript, Tailwind CSS, Lucide Icons, Framer Motion
- **Full-Stack Runtime:** Express.js + Vite Middleware (`server.ts`)
- **AI Engine:** `@google/genai` TypeScript SDK with multi-model cascade (`gemini-3.1-flash-lite`, `gemini-2.5-flash`, `gemini-3.8-flash`)
- **Audio/Video Processing:** FFmpeg stream cutting, HTML5 Web Audio API, Web Workers
- **Cross-Platform:** Electron desktop wrapper, Capacitor mobile compatibility, Progressive Web App (PWA)

---

## 🤝 How to Contribute

We welcome open-source contributions from developers worldwide!

1. **Fork the Repository:**
   Click the "Fork" button at the top right of this repository on GitHub.

2. **Create a Feature Branch:**
   ```bash
   git checkout -b feature/amazing-feature
   ```

3. **Commit Your Changes:**
   *Note: Ensure NO API keys or credentials are committed.*
   ```bash
   git commit -m "feat: Add amazing new subtitle feature"
   ```

4. **Push to Your Branch:**
   ```bash
   git push origin feature/amazing-feature
   ```

5. **Open a Pull Request:**
   Go to your fork on GitHub and click "New Pull Request". Provide a clear description of your improvements or bug fixes.

---

## 📄 License

This project is open-source under the MIT License. You are free to use, modify, and distribute it for personal or commercial projects.
