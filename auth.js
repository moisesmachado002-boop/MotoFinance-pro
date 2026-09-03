'use strict';

(function () {
    const SUPABASE_URL = 'https://pqcltcegwmyuzytivakt.supabase.co';
    const SUPABASE_KEY = ['sb','publishable','3B61vWHjC','Qu3ksO0GJVXA','d','ytJyop'].join('_');
    const $ = id => document.getElementById(id);
    const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    const cleanAuthUrl = mode => new URL('auth.html?mode=' + mode, location.href).href;
    const signupAuth = window.MotoFinanceSyncCore.createAuthService(client, cleanAuthUrl('login'));
    const recoveryAuth = window.MotoFinanceSyncCore.createAuthService(client, cleanAuthUrl('recovery'));
    const params = new URLSearchParams(location.search);
    let mode = params.get('mode') || 'login';

    function notice(text, type = 'info') {
        const box = $('notice');
        box.textContent = text || '';
        box.className = 'notice' + (text ? ' show ' + type : '');
    }

    function setMode(nextMode) {
        mode = ['login', 'signup', 'reset', 'recovery'].includes(nextMode) ? nextMode : 'login';
        const settings = {
            login: ['Conta', 'Entrar', 'Acesse sua conta para sincronizar seus dados entre aparelhos.', 'Entrar'],
            signup: ['Nova conta', 'Criar conta', 'Crie uma conta com e-mail e senha. Seus dados locais não serão enviados sem sua escolha.', 'Criar conta'],
            reset: ['Recuperação', 'Redefinir senha', 'Informe o e-mail da conta para receber o link de recuperação.', 'Enviar link'],
            recovery: ['Nova senha', 'Definir nova senha', 'Escolha uma nova senha para sua conta.', 'Salvar nova senha']
        }[mode];
        $('eyebrow').textContent = settings[0];
        $('title').textContent = settings[1];
        $('description').textContent = settings[2];
        $('submitButton').textContent = settings[3];
        $('emailField').hidden = mode === 'recovery';
        $('passwordField').hidden = mode === 'reset';
        $('confirmField').hidden = !['signup', 'recovery'].includes(mode);
        $('email').required = mode !== 'recovery';
        $('password').required = mode !== 'reset';
        $('confirmPassword').required = ['signup', 'recovery'].includes(mode);
        $('password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    }

    function authErrorFromUrl() {
        const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
        return params.get('error_description') || hash.get('error_description') || '';
    }

    async function submit(event) {
        event.preventDefault();
        notice('');
        const button = $('submitButton');
        button.disabled = true;
        try {
            const email = $('email').value.trim();
            const password = $('password').value;
            const confirm = $('confirmPassword').value;
            let result;
            if (mode === 'login') {
                result = await signupAuth.signIn(email, password);
                if (result.error) throw result.error;
                location.replace('./#more');
                return;
            }
            if (mode === 'signup') {
                if (password !== confirm) throw new Error('As senhas não coincidem.');
                result = await signupAuth.signUp(email, password);
                if (result.error) throw result.error;
                if (result.data?.session) location.replace('./#more');
                else notice('Conta criada. Confira seu e-mail para confirmar o cadastro e depois entre no aplicativo.', 'ok');
                return;
            }
            if (mode === 'reset') {
                result = await recoveryAuth.resetPassword(email);
                if (result.error) throw result.error;
                notice('Link enviado. Abra o e-mail neste aparelho e defina a nova senha.', 'ok');
                return;
            }
            if (password !== confirm) throw new Error('As senhas não coincidem.');
            result = await recoveryAuth.updatePassword(password);
            if (result.error) throw result.error;
            notice('Senha atualizada com sucesso. Você já pode voltar ao aplicativo.', 'ok');
            setTimeout(() => location.replace('./#more'), 900);
        } catch (error) {
            notice(error?.message || 'Não foi possível concluir a operação.', 'error');
        } finally {
            button.disabled = false;
        }
    }

    client.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY') {
            setMode('recovery');
            history.replaceState(null, '', 'auth.html?mode=recovery');
            notice('Link validado. Defina sua nova senha.', 'info');
        }
    });

    const urlError = authErrorFromUrl();
    setMode(mode);
    if (urlError) notice(decodeURIComponent(urlError.replace(/\+/g, ' ')), 'error');
    $('authForm').addEventListener('submit', submit);
})();
