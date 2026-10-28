import { createClient } from '@supabase/supabase-js';
import './style.css';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const supabase = supabaseConfigured
 ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
 : null;
const state = {
 user: null,
 gifts: [],
 filter: 'mami',
 occasion: 'Navidad',
 loading: false,
 saving: false,
 recoveryMode: false,
};
const app = document.querySelector('#app');
const money = (value) =>
 value === null || value === undefined || value === ''
   ? 'Precio sin cargar'
   : new Intl.NumberFormat('es-AR', {
       style: 'currency',
       currency: 'ARS',
       maximumFractionDigits: 0,
     }).format(Number(value));
const escapeHtml = (value = '') =>
 String(value).replace(/[&<>"']/g, (c) => ({
   '&': '&amp;',
   '<': '&lt;',
   '>': '&gt;',
   '"': '&quot;',
   "'": '&#39;',
 })[c]);
const personLabel = (p) =>
 ({ mami: 'Regalos Mami', papi: 'Regalos Papi', chunguita: 'Regalos Chunguita' }[p] || p);
const categoryLabel = (c) =>
 ({ barato: 'Barato', mediano: 'Mediano', caro: 'Caro', ninguna: 'Sin categoría' }[c] || c);
function render() {
 if (!supabaseConfigured) {
   app.innerHTML = `
<main class="setup-wrap">
<section class="setup-card">
<p class="eyebrow">NUESTRA LISTA DE REGALOS</p>
<h1>Un lugar para guardar esos regalos que nos hacen ilusión.</h1>
<p>La página está preparada. Para que sea online, privada y compartida, falta conectarla a una base de datos de Supabase y configurar el despliegue.</p>
<div class="notice"><strong>Configuración pendiente</strong><br>Seguí los pasos de <code>README.md</code>. No cargues regalos reales hasta terminar la configuración privada.</div>
<div class="preview-pills"><span>Regalos Mami</span><span>Regalos Papi</span><span>Regalos Chunguita</span></div>
</section>
</main>`;
   return;
 }
 if (state.recoveryMode) {
   renderPasswordRecovery();
   return;
 }
 if (!state.user) {
   app.innerHTML = `
<main class="auth-wrap">
<section class="auth-card">
<p class="eyebrow">SOLO PARA NOSOTROS</p>
<h1>Regalitos para nosotros 🫰🏼</h1>
<form id="auth-form">
<label>Email<input name="email" type="email" placeholder="tu@email.com" required autocomplete="email"></label>
<label>Contraseña<input name="password" type="password" placeholder="Tu contraseña" required minlength="8" autocomplete="current-password"></label>
<button class="primary" type="submit">Entrar</button>
</form>
<button class="text-button" id="forgot-password" type="button">¿Olvidaste tu contraseña?</button>
<p class="small">Si todavía no tenés una cuenta, usá “Crear cuenta”.</p>
<button class="text-button" id="signup" type="button">Crear cuenta</button>
<p id="auth-message" class="message" role="status"></p>
</section>
</main>`;
   document.querySelector('#auth-form').addEventListener('submit', async (e) => {
     e.preventDefault();
     const fd = new FormData(e.currentTarget);
     setAuthMessage('Ingresando…');
     const { error } = await supabase.auth.signInWithPassword({
       email: String(fd.get('email')).trim(),
       password: String(fd.get('password')),
     });
     if (error) setAuthMessage(authErrorMessage(error));
   });
   document.querySelector('#forgot-password').addEventListener('click', async () => {
     const emailInput = document.querySelector('#auth-form [name="email"]');
     const email = String(emailInput.value || '').trim();
     if (!email) {
       setAuthMessage('Escribí tu email arriba y después tocá “¿Olvidaste tu contraseña?”.');
       emailInput.focus();
       return;
     }
     setAuthMessage('Enviando el enlace de recuperación…');
     const { error } = await supabase.auth.resetPasswordForEmail(email, {
       redirectTo: window.location.origin,
     });
     setAuthMessage(
       error
         ? `No pudimos enviar el correo: ${authErrorMessage(error)}`
         : 'Si ese email tiene una cuenta, te va a llegar un enlace para cambiar la contraseña. Abrilo una sola vez y usalo pronto.'
     );
   });
   document.querySelector('#signup').addEventListener('click', async () => {
     const form = document.querySelector('#auth-form');
     const fd = new FormData(form);
     const email = String(fd.get('email') || '').trim();
     const password = String(fd.get('password') || '');
     if (!email || password.length < 8) {
       setAuthMessage('Completá el email y una contraseña de al menos 8 caracteres.');
       return;
     }
     setAuthMessage('Creando cuenta…');
     const { error } = await supabase.auth.signUp({ email, password });
     setAuthMessage(
       error
         ? authErrorMessage(error)
         : 'Cuenta creada. Si Supabase pide confirmar el email, revisá tu correo antes de entrar.'
     );
   });
   return;
 }
 const personTabs = ['mami', 'papi', 'chunguita']
   .map((p) => `<button class="tab ${state.filter === p ? 'active' : ''}" data-person="${p}">${personLabel(p)}</button>`)
   .join('');
 const filtered = state.gifts
   .filter((g) => g.person === state.filter)
   .sort((a, b) =>
     a.category === b.category
       ? (a.priority || 99) - (b.priority || 99)
       : ['barato', 'mediano', 'caro', 'ninguna'].indexOf(a.category) -
         ['barato', 'mediano', 'caro', 'ninguna'].indexOf(b.category)
   );
 const content = state.filter === 'chunguita'
   ? renderChunguita(filtered)
   : renderParent(filtered);
 app.innerHTML = `
<div class="shell">
<header class="topbar">
<div><p class="eyebrow">LISTA COMPARTIDA</p><h1>Regalitos para nosotros 🫰🏼</h1></div>
<button class="logout" id="logout">Salir</button>
</header>
<nav class="tabs">${personTabs}</nav>
<section class="section-heading"><h2>${personLabel(state.filter)}</h2><button class="primary add-button" id="add-gift">＋ Agregar regalo</button></section>
<div id="gift-form-wrap"></div>
     ${content || '<div class="empty"><div class="empty-icon">＋</div><h3>Todavía no hay regalos</h3><p>Agregá un link y armá la lista entre los dos.</p></div>'}
<footer>Los cambios se guardan online para los dos.</footer>
</div>`;
 document.querySelectorAll('[data-person]').forEach((button) =>
   button.addEventListener('click', () => {
     state.filter = button.dataset.person;
     render();
   })
 );
 document.querySelector('#logout').addEventListener('click', async () => {
   await supabase.auth.signOut();
 });
 document.querySelector('#add-gift').addEventListener('click', () => showGiftForm());
 document.querySelectorAll('[data-delete]').forEach((button) =>
   button.addEventListener('click', () => deleteGift(button.dataset.delete))
 );
 document.querySelectorAll('[data-edit]').forEach((button) =>
   button.addEventListener('click', () => {
     const id = button.dataset.edit;
     const gift = state.gifts.find((item) => String(item.id) === String(id));
     if (!id || id === 'undefined' || !gift?.id) {
       alert('No encontramos el identificador de ese regalo. Actualizá la página y volvé a abrirlo.');
       loadGifts();
       return;
     }
     showGiftForm(gift);
   })
 );
}
function renderPasswordRecovery() {
 app.innerHTML = `
<main class="auth-wrap">
<section class="auth-card">
<p class="eyebrow">RECUPERAR ACCESO</p>
<h1>Elegí una contraseña nueva</h1>
<p class="small">Ingresá la nueva contraseña dos veces para confirmar el cambio.</p>
<form id="recovery-form">
<label>Nueva contraseña<input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="Mínimo 8 caracteres"></label>
<label>Repetí la contraseña<input name="confirmPassword" type="password" required minlength="8" autocomplete="new-password" placeholder="Repetí la contraseña"></label>
<button class="primary" type="submit">Guardar contraseña nueva</button>
</form>
<p id="recovery-message" class="message" role="status"></p>
</section>
</main>`;
 document.querySelector('#recovery-form').addEventListener('submit', async (e) => {
   e.preventDefault();
   const fd = new FormData(e.currentTarget);
   const password = String(fd.get('password') || '');
   const confirmation = String(fd.get('confirmPassword') || '');
   const message = document.querySelector('#recovery-message');
   if (password.length < 8) {
     message.textContent = 'La contraseña debe tener al menos 8 caracteres.';
     return;
   }
   if (password !== confirmation) {
     message.textContent = 'Las contraseñas no coinciden. Revisalas e intentá de nuevo.';
     return;
   }
   const button = e.currentTarget.querySelector('button[type="submit"]');
   button.disabled = true;
   message.textContent = 'Actualizando contraseña…';
   const { error } = await supabase.auth.updateUser({ password });
   button.disabled = false;
   if (error) {
     message.textContent = `No pudimos cambiar la contraseña: ${authErrorMessage(error)}. Si el enlace venció, volvé al inicio y pedí uno nuevo.`;
     return;
   }
   state.recoveryMode = false;
   const { data } = await supabase.auth.getSession();
   state.user = data.session?.user || null;
   if (state.user) {
     await loadGifts();
     subscribeToGifts();
     render();
   } else {
     app.innerHTML = `
<main class="auth-wrap"><section class="auth-card">
<h1>Contraseña actualizada</h1>
<p>Ya podés entrar con tu nueva contraseña.</p>
<button class="primary" id="back-to-login">Volver a entrar</button>
</section></main>`;
     document.querySelector('#back-to-login').addEventListener('click', () => render());
   }
 });
}
function authErrorMessage(error) {
 const message = String(error?.message || 'Error inesperado.');
 if (/invalid login credentials/i.test(message)) {
   return 'El email o la contraseña no coinciden.';
 }
 if (/otp_expired|expired/i.test(message)) {
   return 'El enlace venció o ya se usó. Pedí uno nuevo desde “¿Olvidaste tu contraseña?”.';
 }
 if (/email not confirmed/i.test(message)) {
   return 'Primero confirmá tu email desde el correo que te envió Supabase.';
 }
 return message;
}
