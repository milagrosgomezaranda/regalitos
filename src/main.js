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
function renderParent(gifts) {

  return ['barato', 'mediano', 'caro'].map((cat) => {

    const items = gifts.filter((g) => g.category === cat);

    if (!items.length) return '';

    return `
<section class="category">
<div class="category-title">
<h3>${categoryLabel(cat)}</h3>
<span>${items.length} ${items.length === 1 ? 'regalo' : 'regalos'}</span>
</div>
<div class="gift-grid">${items.map(giftCard).join('')}</div>
</section>`;

  }).join('');

}

function renderChunguita(gifts) {

  return gifts.length

    ? `<div class="gift-grid">${gifts.map(giftCard).join('')}</div>`

    : '';

}

function giftCard(g) {

  const img = g.image_url || '';

  const priority = g.person === 'chunguita'

    ? ''

    : `<span class="priority">Prioridad ${g.priority || '—'}</span>`;

  return `
<article class="gift-card">
<div class="gift-image">

        ${img

          ? `<img src="${escapeHtml(img)}" alt="" loading="lazy"

              onerror="this.style.display='none';this.parentElement.classList.add('no-image')">`

          : '<span class="image-placeholder">Foto pendiente</span>'}
</div>
<div class="gift-body">

        ${priority}
<h3>${escapeHtml(g.title)}</h3>
<p class="price">${money(g.price)}</p>

        ${g.notes ? `<p class="notes">${escapeHtml(g.notes)}</p>` : ''}
<div class="card-actions">

          ${g.product_url

            ? `<a class="link-button" href="${escapeHtml(g.product_url)}"

                 target="_blank" rel="noopener noreferrer">Ver producto ↗</a>`

            : ''}
<button class="subtle-button" data-edit="${escapeHtml(g.id || '')}">Editar</button>
<button class="subtle-button delete" data-delete="${escapeHtml(g.id || '')}">Borrar</button>
</div>
</div>
</article>`;

}

function showGiftForm(gift = null) {

  const isEditing = Boolean(gift?.id);

  const isChunguita = state.filter === 'chunguita';

  document.querySelector('#gift-form-wrap').innerHTML = `
<form id="gift-form" class="gift-form">
<div class="form-top">
<h3>${isEditing ? 'Editar regalo' : 'Agregar regalo'}</h3>
<button type="button" class="close-form" id="close-form" aria-label="Cerrar">×</button>
</div>
<label>Link del producto
<input name="product_url" type="url" placeholder="https://..."

          value="${escapeHtml(gift?.product_url || '')}">
</label>
<button class="secondary" type="button" id="fetch-product">

        Completar con datos de la tienda
</button>
<p id="fetch-message" class="small"></p>
<div class="form-grid">
<label>Nombre
<input name="title" required placeholder="Ej. Auriculares"

            value="${escapeHtml(gift?.title || '')}">
</label>
<label>Precio en pesos
<input name="price" type="number" min="0" step="1" placeholder="180000"

            value="${gift?.price ?? ''}">
</label>
</div>
<label>URL de la foto
<input name="image_url" type="url" placeholder="Se completa al buscar el link"

          value="${escapeHtml(gift?.image_url || '')}">
</label>
<div class="photo-preview" id="photo-preview" ${gift?.image_url ? '' : 'hidden'}>
<img id="photo-preview-img" src="${escapeHtml(gift?.image_url || '')}"

          alt="Vista previa de la foto">
<span>Vista previa de la foto</span>
</div>

      ${!isChunguita ? `
<div class="form-grid">
<label>Categoría
<select name="category" required>
<option value="barato" ${gift?.category === 'barato' ? 'selected' : ''}>Barato</option>
<option value="mediano" ${gift?.category === 'mediano' ? 'selected' : ''}>Mediano</option>
<option value="caro" ${gift?.category === 'caro' ? 'selected' : ''}>Caro</option>
</select>
</label>
<label>Prioridad
<select name="priority" required>
<option value="1" ${String(gift?.priority || 1) === '1' ? 'selected' : ''}>1 · El que más quiero</option>
<option value="2" ${String(gift?.priority || 1) === '2' ? 'selected' : ''}>2 · También me gusta</option>
<option value="3" ${String(gift?.priority || 1) === '3' ? 'selected' : ''}>3 · Otra opción</option>
</select>
</label>
</div>

      ` : `
<input type="hidden" name="category" value="ninguna">
<input type="hidden" name="priority" value="">

      `}
<label>Nota (opcional)
<textarea name="notes" rows="2" placeholder="Color, talle, modelo...">${escapeHtml(gift?.notes || '')}</textarea>
</label>
<button class="primary" type="submit">

        ${isEditing ? 'Guardar cambios' : 'Guardar regalo'}
</button>
<p id="save-message" class="message"></p>
</form>`;

  document.querySelector('#close-form').addEventListener('click', () => {

    document.querySelector('#gift-form-wrap').innerHTML = '';

  });

  document.querySelector('#fetch-product').addEventListener('click', fetchProduct);

  const photoInput = document.querySelector('#gift-form [name="image_url"]');

  photoInput.addEventListener('input', updatePhotoPreview);

  photoInput.addEventListener('change', updatePhotoPreview);

  document.querySelector('#gift-form').addEventListener('submit', async (e) => {

    e.preventDefault();

    const fd = new FormData(e.currentTarget);

    const msg = document.querySelector('#save-message');

    if (!state.user?.id) {

      msg.textContent = 'Tu sesión venció. Volvé a entrar y probá de nuevo.';

      return;

    }

    if (isEditing && !gift?.id) {

      msg.textContent = 'No encontramos el identificador del regalo. Volvé a abrirlo desde la tarjeta.';

      return;

    }

    const data = {

      person: state.filter,

      title: String(fd.get('title') || '').trim(),

      product_url: String(fd.get('product_url') || '').trim() || null,

      image_url: String(fd.get('image_url') || '').trim() || null,

      price: fd.get('price') ? Number(fd.get('price')) : null,

      category: String(fd.get('category')),

      priority: fd.get('priority') ? Number(fd.get('priority')) : null,

      notes: String(fd.get('notes') || '').trim() || null,

      occasion: state.occasion,

      updated_by: state.user.id,

    };

    const saveButton = e.currentTarget.querySelector('button[type="submit"]');

    saveButton.disabled = true;

    msg.textContent = 'Guardando…';

    try {

      const result = isEditing

        ? await supabase.from('gifts').update(data).eq('id', gift.id).select().single()

        : await supabase.from('gifts').insert(data).select().single();

      if (result.error) {

        msg.textContent = `No se pudo guardar: ${result.error.message}`;

        return;

      }

      document.querySelector('#gift-form-wrap').innerHTML = '';

      await loadGifts();

    } catch (error) {

      msg.textContent = `Ocurrió un error al guardar: ${error.message}`;

    } finally {

      saveButton.disabled = false;

    }

  });

}

async function fetchProduct() {

  const form = document.querySelector('#gift-form');

  const fd = new FormData(form);

  const url = String(fd.get('product_url') || '').trim();

  const msg = document.querySelector('#fetch-message');

  const button = document.querySelector('#fetch-product');

  if (!url) {

    msg.textContent = 'Pegá primero el link del producto.';

    return;

  }

  button.disabled = true;

  msg.textContent = 'Buscando la foto y los datos…';

  try {

    const response = await fetch(`/api/product?url=${encodeURIComponent(url)}`);

    const data = await response.json();

    if (!response.ok) {

      throw new Error(data.error || 'No se pudieron obtener los datos de esa tienda.');

    }

    if (data.title) form.elements.title.value = data.title;

    if (data.image) {

      form.elements.image_url.value = data.image;

      updatePhotoPreview();

    }

    if (data.price !== null && data.price !== undefined &&

        Number.isFinite(Number(data.price))) {

      form.elements.price.value = String(Math.round(Number(data.price)));

    }

    msg.textContent = data.title || data.image || data.price != null

      ? 'Encontramos datos de la tienda. Revisalos antes de guardar.'

      : 'No pudimos leer los datos automáticamente. Podés completarlos a mano.';

  } catch (error) {

    msg.textContent = `${error.message} Podés completar los datos manualmente.`;

  } finally {

    button.disabled = false;

  }

}

function updatePhotoPreview() {

  const form = document.querySelector('#gift-form');

  if (!form) return;

  const url = String(form.elements.image_url.value || '').trim();

  const preview = document.querySelector('#photo-preview');

  const img = document.querySelector('#photo-preview-img');

  if (!preview || !img) return;

  if (!url) {

    preview.hidden = true;

    img.removeAttribute('src');

    return;

  }

  preview.hidden = false;

  img.src = url;

  img.onerror = () => {

    preview.hidden = true;

  };

}

async function deleteGift(id) {

  if (!id || id === 'undefined') {

    alert('No encontramos el identificador de este regalo. Actualizá la página y probá de nuevo.');

    return;

  }

  if (!confirm('¿Querés borrar este regalo?')) return;

  const { error } = await supabase.from('gifts').delete().eq('id', id);

  if (error) {

    alert(`No se pudo borrar: ${error.message}`);

  } else {

    await loadGifts();

  }

}

function setAuthMessage(message) {

  const el = document.querySelector('#auth-message');

  if (el) el.textContent = message;

}

async function loadGifts() {

  if (!supabase || !state.user) return;

  state.loading = true;

  const { data, error } = await supabase

    .from('gifts')

    .select('*')

    .order('created_at', { ascending: false });

  state.loading = false;

  if (error) {

    app.innerHTML = `
<main class="auth-wrap">
<section class="auth-card">
<h1>No pudimos cargar la lista</h1>
<p>${escapeHtml(error.message)}</p>
</section>
</main>`;

    return;

  }

  state.gifts = (data || []).filter((gift) => gift && gift.id);

  render();

}

let giftsChannel = null;

function subscribeToGifts() {

  if (!supabase || !state.user) return;

  if (giftsChannel) supabase.removeChannel(giftsChannel);

  giftsChannel = supabase

    .channel('shared-gifts-live')

    .on(

      'postgres_changes',

      { event: '*', schema: 'public', table: 'gifts' },

      () => loadGifts()

    )

    .subscribe();

}

if (supabase) {

  supabase.auth.onAuthStateChange((event, session) => {

    if (event === 'PASSWORD_RECOVERY') {

      state.recoveryMode = true;

      state.user = session?.user || null;

      renderPasswordRecovery();

      return;

    }

    if (event === 'SIGNED_OUT') {

      state.recoveryMode = false;

      state.user = null;

      state.gifts = [];

      if (giftsChannel) supabase.removeChannel(giftsChannel);

      giftsChannel = null;

      render();

      return;

    }

    state.user = session?.user || null;

    if (state.recoveryMode) {

      renderPasswordRecovery();

      return;

    }

    if (state.user) {

      loadGifts();

      subscribeToGifts();

    } else {

      render();

    }

  });

  supabase.auth.getSession().then(({ data, error }) => {

    if (error) {

      render();

      return;

    }

    state.user = data.session?.user || null;

    if (state.recoveryMode) {

      renderPasswordRecovery();

    } else if (state.user) {

      loadGifts();

      subscribeToGifts();

    } else {

      render();

    }

  });

} else {

  render();

}
 
