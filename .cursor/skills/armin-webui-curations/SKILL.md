---
name: armin-webui-curations
description: UI/UX design standards and component curations for Armin Dashti's WebUI. Use when creating new WebUI components, layouts, or apps from scratch, or when the user explicitly requests to redesign/restyle an existing UI. Do not enforce for minor edits or routine bug fixes.
author: "Armin Dashti"
uuid: 85159c7b-e318-458f-928d-08465bd037a9
---

# Armin WebUI Curations & Design Guidelines

This skill defines the user interface rules, typography, themes, and component specifications to ensure visual consistency across all WebUI projects.

---

## 1. Skill Activation & Scope

- **When to Apply:**
  - **New Creation (Default):** Always apply these guidelines when generating, scaffolding, or creating new WebUI layouts, pages, components, or applications from scratch.
  - **Explicit Redesign:** Apply these rules to existing code **only** if the user explicitly requests to redesign, restyle, or align a part of the interface with this skill.
- **When NOT to Apply:**
  - **Routine Editing & Maintenance:** Do **not** enforce these rules during standard edits, bug fixes, logic updates, or minor tweaks on existing components. Maintain the existing codebase style unless a redesign is requested.

---

## 2. Theme & Typography

- **Default Theme:** Always use **Dark+** as the default dark theme.
- **Typography:**
  - **English-only WebUI:** Use **Inter Sans**.
  - **Bilingual (English / Persian) WebUI:** Use **Vazir Matn**.
- **Font Color:** Always use a bright white font color for optimal contrast and readability.
- **Icons:**
  - Ensure all icons are fully compatible with both dark and light modes.
  - Provide dedicated icon variants for dark and light themes respectively.

---

## 3. Layout & Navigation

- **General Layout:** Follow the predefined layout structures found in `./curations/layout/`.
- **Header:** Select and implement an appropriate header configuration based on samples in `./curations/header/`.
- **Sidebar Menu:**
  - Always include a **collapse/expand** toggle button.
  - Reference implementation: `./curations/side-bar-menu/`.
- **Footer:**
  - **Placement:** Anchored at the end of the scrollable page area with a compact (low) height.
  - **Left Side:** Include a GitHub link to [https://github.com/armindashti](https://github.com/armindashti).
  - **Copyright Text:** `Created by Armin Dashti`.
  - Reference implementation: `./curations/footer/`.

---

## 4. UI Components

- **Buttons:**
  - Always design buttons with **rounded corners** and accompanying **icons**.
  - Reference implementation: `./curations/buttons/`.
- **Textboxes:**
  - Dynamically scale and size textboxes according to their intended input purpose.
  - Reference implementation: `./curations/textbox/`.
- **Dropdowns:**
  - Follow the sample components in `./curations/dropdown/`.

---

## 5. Modals & Animations

- **Dialogs & Overlays:** All modal dialogs (informational messages, warnings, errors, prompts) must include smooth **fade-in** (open) and **fade-out** (close) transitions.

---

## 6. Views, Settings & Templates

- **Settings View:** By default, the settings panel must include the following sections/tabs:
  1. **Appearance**
  2. **Update**
  3. **Feedback**
  4. **About Me**
- **About Me & Feedback:** Use the templates and guidelines provided in `./curations/about-me/`.

---

## 7. Directory References Summary

| Component | Path |
| :--- | :--- |
| **Layouts** | `./curations/layout/` |
| **Header** | `./curations/header/` |
| **Sidebar Menu** | `./curations/side-bar-menu/` |
| **Footer** | `./curations/footer/` |
| **Buttons** | `./curations/buttons/` |
| **Textboxes** | `./curations/textbox/` |
| **Dropdowns** | `./curations/dropdown/` |
| **About Me & Feedback** | `./curations/about-me/` |