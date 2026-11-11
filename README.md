<div align="center">

# 🚘 MyGarage

### Every vehicle. One intelligent garage.

<img src="https://readme-typing-svg.demolab.com?font=Inter&weight=500&size=19&duration=2800&pause=900&color=38BDF8&center=true&vCenter=true&width=750&lines=Documents+organized.+Ownership+simplified.;Gmail+%E2%86%92+PDF+%E2%86%92+Smart+classification.;One+React+codebase.+Web+%2B+Android." alt="Animated tagline" />

<br />

<img src="https://img.shields.io/badge/STATUS-ACTIVE%20DEVELOPMENT-0EA5E9?style=for-the-badge&labelColor=080D1B" alt="Status" />
<img src="https://img.shields.io/badge/PLATFORM-WEB%20%2B%20ANDROID-38BDF8?style=for-the-badge&labelColor=080D1B" alt="Platform" />
<img src="https://img.shields.io/badge/BACKEND-SUPABASE-3FCF8E?style=for-the-badge&labelColor=080D1B" alt="Backend" />
<img src="https://img.shields.io/badge/HOSTED%20ON-CLOUDFLARE-F38020?style=for-the-badge&labelColor=080D1B" alt="Cloudflare" />

<br /><br />

**One place to manage vehicles, organize documents and simplify the responsibilities of ownership.**

</div>

<br />

## ✦ About

MyGarage is a multi-vehicle management app that brings vehicle details and ownership documents into one connected workspace. It pairs a **React** frontend with **Supabase** services, a **Gmail** integration and a **PDF-processing** pipeline, and ships as a website plus an **Android** app through **Capacitor**.

The goal is simple: fewer scattered records, and an easier way to keep track of what matters for every vehicle you own.

<br />

## ✦ Features at a glance

<table>
  <tr>
    <td colspan="2" width="60%" valign="top">
      <h3>🚘 Multi-vehicle garage</h3>
      <p>A central dashboard for every vehicle you own. Records belong to the <b>user's garage</b>, not to a single hardcoded vehicle.</p>
      <img src="https://img.shields.io/badge/-Dashboard-0EA5E9?style=flat-square&labelColor=080D1B" />
      <img src="https://img.shields.io/badge/-Multi--vehicle-0EA5E9?style=flat-square&labelColor=080D1B" />
    </td>
    <td width="40%" valign="top">
      <h3>☁️ Cloud foundation</h3>
      <p>Supabase Auth and a hosted PostgreSQL database power sign-in and storage.</p>
      <img src="https://img.shields.io/badge/-Auth-3FCF8E?style=flat-square&labelColor=080D1B" />
      <img src="https://img.shields.io/badge/-PostgreSQL-3FCF8E?style=flat-square&labelColor=080D1B" />
    </td>
  </tr>
  <tr>
    <td width="33%" valign="top">
      <h3>📄 Documents</h3>
      <ul>
        <li>Categorization</li>
        <li>Vehicle matching</li>
        <li>Duplicate detection</li>
        <li>Version history</li>
      </ul>
    </td>
    <td width="33%" valign="top">
      <h3>📧 Gmail workflow</h3>
      <p>Connect Gmail with your permission, discover PDF attachments that may be vehicle documents, then review and process them.</p>
    </td>
    <td width="34%" valign="top">
      <h3>🔎 PDF processing</h3>
      <p>Text extraction from supported PDFs, with an OCR fallback for scanned files, to help classify documents and match vehicles.</p>
    </td>
  </tr>
  <tr>
    <td width="40%" valign="top">
      <h3>📱 Web + Android</h3>
      <p>Built with React and Vite. Capacitor packages it for Android, and an APK has been <b>generated and tested</b>.</p>
    </td>
    <td colspan="2" width="60%" valign="top">
      <h3>🔐 Secure by design</h3>
      <p>Gmail access needs explicit user authorization. OAuth credentials and protected operations are handled server-side through <b>Supabase Edge Functions</b>, never in the client.</p>
    </td>
  </tr>
</table>

<br />

## ✦ Tech stack

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🎨 Frontend</h3>
      <img src="https://skillicons.dev/icons?i=react,vite,js,html,css&theme=dark" alt="Frontend icons" />
      <br /><br />
      <b>React 19</b> · <b>Vite 8</b> · <b>JavaScript (JSX)</b> · <b>CSS</b>
    </td>
    <td width="50%" valign="top">
      <h3>⚙️ Backend & cloud</h3>
      <img src="https://skillicons.dev/icons?i=supabase,postgres,cloudflare,deno,ts&theme=dark" alt="Backend icons" />
      <br /><br />
      <b>Supabase</b> (Auth, Storage, Edge Functions) · <b>PostgreSQL</b> · <b>Cloudflare</b> · <b>Deno / TypeScript</b>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🔌 Integrations</h3>
      <b>Gmail API</b> · <b>Google OAuth 2.0</b> · <b>PDF.js</b> · <b>OCR processing</b>
    </td>
    <td width="50%" valign="top">
      <h3>🛠 Mobile & tooling</h3>
      <img src="https://skillicons.dev/icons?i=android,nodejs,git,github,vscode&theme=dark" alt="Tooling icons" />
      <br /><br />
      <b>Capacitor 8</b> · <b>Node.js & npm</b> · <b>ESLint</b> · <b>Git & GitHub</b> · <b>VS Code</b>
    </td>
  </tr>
</table>

<br />

## ✦ Architecture

```mermaid
flowchart TB
    USER(["👤 User"])

    subgraph CLIENT["Client application"]
        UI["React 19 + Vite"]
        GARAGE["Vehicle dashboard"]
        DOCS["Document management"]
        PDF["PDF.js / OCR"]
        MOBILE["Capacitor Android build"]
        UI --> GARAGE
        UI --> DOCS
        DOCS --> PDF
        UI -. packaged with .-> MOBILE
    end

    subgraph CLOUD["Supabase backend"]
        AUTH["Auth"]
        DB[("PostgreSQL")]
        STORAGE["Storage"]
        EDGE["Edge Functions"]
    end

    GMAIL["Gmail API"]
    CF["Cloudflare hosting"]

    USER --> UI
    UI --> AUTH
    UI <--> DB
    UI <--> STORAGE
    DOCS --> EDGE
    EDGE <--> GMAIL
    UI -. deployed on .-> CF
```

<br />

## ✦ How the document workflow works

<table>
  <tr>
    <td align="center" width="16%"><h3>1</h3><b>Connect</b><br />Authorize Gmail</td>
    <td align="center" width="16%"><h3>2</h3><b>Discover</b><br />Find PDF attachments</td>
    <td align="center" width="17%"><h3>3</h3><b>Retrieve</b><br />Via protected function</td>
    <td align="center" width="17%"><h3>4</h3><b>Extract</b><br />PDF text + OCR</td>
    <td align="center" width="17%"><h3>5</h3><b>Classify</b><br />Type + vehicle match</td>
    <td align="center" width="17%"><h3>6</h3><b>Review</b><br />Manage the record</td>
  </tr>
</table>

<br />

## ✦ Progress

<details open>
<summary><b>01 · Application foundation</b> &nbsp;<img src="https://img.shields.io/badge/-COMPLETED-22C55E?style=flat-square&labelColor=080D1B" /></summary>
<br />

- [x] React + Vite application
- [x] Supabase authentication
- [x] Cloud database integration
- [x] Multi-vehicle management
- [x] Cloudflare deployment
- [x] Android APK generation and testing

</details>

<details open>
<summary><b>02 · Document management</b> &nbsp;<img src="https://img.shields.io/badge/-IN%20PROGRESS-F59E0B?style=flat-square&labelColor=080D1B" /></summary>
<br />

- [x] Document categorization
- [x] Vehicle matching
- [x] Duplicate detection
- [x] Document version history
- [x] Gmail account integration
- [x] PDF attachment discovery and retrieval
- [x] PDF text extraction
- [ ] Improve reliability across PDF formats and attachment sizes
- [ ] Complete and harden automated document processing
- [ ] Improve extraction and classification accuracy

</details>

<details>
<summary><b>03 · Ownership automation</b> &nbsp;<img src="https://img.shields.io/badge/-PLANNED-64748B?style=flat-square&labelColor=080D1B" /></summary>
<br />

- [ ] Document-expiry notifications
- [ ] Insurance and PUC renewal reminders
- [ ] Maintenance and service tracking
- [ ] Next-service reminders
- [ ] Expanded mobile experience
- [ ] Intelligent vehicle insights

</details>

<br />

## ✦ Roadmap

<table>
  <tr>
    <td width="20%" valign="top"><h3>🧠</h3><b>Document intelligence</b><br />Better extraction, classification and vehicle matching</td>
    <td width="20%" valign="top"><h3>🔔</h3><b>Renewals</b><br />Expiry dates, reminders and notification delivery</td>
    <td width="20%" valign="top"><h3>🔧</h3><b>Maintenance</b><br />Service history, costs and next-service tracking</td>
    <td width="20%" valign="top"><h3>📱</h3><b>Mobile</b><br />A smoother Android experience</td>
    <td width="20%" valign="top"><h3>📊</h3><b>Insights</b><br />Useful summaries across all your vehicles</td>
  </tr>
</table>

<br />

## ✦ Engineering principles

- **Multi-vehicle first:** features work across a user's whole garage.
- **Reliable documents:** PDFs vary in quality, so extraction is validated and fails gracefully.
- **Secure integrations:** explicit user consent for Gmail, and protected handling of OAuth credentials.
- **Incremental delivery:** finished foundations are clearly separated from work in progress.
- **One codebase:** the React app is packaged for Android through Capacitor.

<br />

## ✦ Run it locally

**Prerequisites:** Node.js and npm, Git, and a Supabase project with the required environment configuration.

```bash
# Clone the repository
git clone https://github.com/AlwinJCOde667/MyGarage.git
cd MyGarage

# Install dependencies and start the dev server
npm install
npm run dev
```

| Script | What it does |
|---|---|
| `npm run dev` | Start the Vite development server |
| `npm run build` | Create a production build |
| `npm run preview` | Preview the production build |
| `npm run lint` | Run ESLint |

> [!WARNING]
> Configure your Supabase and Google OAuth settings before using authenticated and Gmail-connected features. Never commit API secrets, service-role keys, OAuth client secrets or private environment files.

<br />

<div align="center">

## ✦ Built by

**Alwin John Shajan**
<br />
Computer Science & Engineering

<a href="https://github.com/AlwinJCOde667">
  <img src="https://img.shields.io/badge/GitHub-AlwinJCOde667-FFFFFF?style=for-the-badge&logo=github&logoColor=000000" alt="GitHub profile" />
</a>

<br /><br />

<em>Designed around a simple idea: vehicle ownership should be easier to manage.</em>

</div>
