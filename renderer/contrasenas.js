// Galeón — gestión de contraseñas (galeon://contraseñas)
const g = window.galeonPage || {};
const $ = (id) => document.getElementById(id);

async function render() {
  if (!g.pwdList) return;
  const list = await g.pwdList();
  const box = $('list');
  box.textContent = '';
  $('note').textContent = list.length
    ? `🔒 ${list.length} clave${list.length === 1 ? '' : 's'} en tu bóveda local`
    : 'Aún no hay claves guardadas. Inicia sesión en un sitio y Galeón te ofrecerá guardarla.';

  for (const p of list) {
    const el = document.createElement('div');
    el.className = 'entry';

    const origin = document.createElement('div');
    origin.className = 'e-origin';
    origin.textContent = p.origin;

    const user = document.createElement('div');
    user.className = 'e-user';
    user.textContent = '👤 ' + p.username;

    const pass = document.createElement('div');
    pass.className = 'e-pass';
    pass.textContent = '••••••••••';

    const btns = document.createElement('div');
    btns.className = 'e-btns';

    const bReveal = document.createElement('button');
    bReveal.textContent = 'Revelar';
    bReveal.addEventListener('click', async () => {
      if (bReveal.dataset.open === '1') {
        pass.textContent = '••••••••••';
        bReveal.dataset.open = '';
        bReveal.textContent = 'Revelar';
        return;
      }
      const pw = await g.pwdReveal({ origin: p.origin, username: p.username });
      if (pw) {
        pass.textContent = pw;
        bReveal.dataset.open = '1';
        bReveal.textContent = 'Ocultar';
        setTimeout(() => { // no dejar la clave en pantalla para siempre
          pass.textContent = '••••••••••';
          bReveal.dataset.open = '';
          bReveal.textContent = 'Revelar';
        }, 20000);
      }
    });

    const bCopy = document.createElement('button');
    bCopy.textContent = 'Copiar';
    bCopy.addEventListener('click', async () => {
      const pw = await g.pwdReveal({ origin: p.origin, username: p.username });
      if (pw && navigator.clipboard) {
        await navigator.clipboard.writeText(pw);
        bCopy.textContent = '✓ Copiada';
        setTimeout(() => { bCopy.textContent = 'Copiar'; }, 2000);
      }
    });

    const bDel = document.createElement('button');
    bDel.className = 'del';
    bDel.textContent = 'Eliminar';
    bDel.addEventListener('click', async () => {
      if (confirm(`¿Eliminar la clave de ${p.username} en ${p.origin}?`)) {
        await g.pwdDelete({ origin: p.origin, username: p.username });
        render();
      }
    });

    btns.append(bReveal, bCopy, bDel);
    el.append(origin, user, pass, btns);
    box.appendChild(el);
  }
}

render();
