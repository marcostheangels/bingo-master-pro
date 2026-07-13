const { Resend } = require('resend');

let resend = null;
if (process.env.RESEND_API_KEY) {
    try {
        resend = new Resend(process.env.RESEND_API_KEY);
    } catch (e) {
        console.log('[EMAIL] Resend não inicializado:', e.message);
    }
}

async function alertarNovoCadastro(nomeUsuario, emailUsuario) {
    if (!resend) {
        console.log('[EMAIL] Resend não configurado, pulando notificação.');
        return;
    }
    try {
        const data = await resend.emails.send({
            from: 'onboarding@resend.dev', // Nota: Se você tem um domínio verificado no Resend, use o seu e-mail aqui
            to: process.env.ADMIN_EMAIL || process.env.SMTP_USER,
            subject: '🔔 Novo Usuário Cadastrado no Bingo Master!',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px; max-width: 500px;">
                    <h2 style="color: #4CAF50; margin-top: 0;">🎰 Novo Jogador Registrado!</h2>
                    <p>Olá, Marcos! Um novo usuário acabou de se cadastrar na plataforma:</p>
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 15px 0;">
                    <p><strong>👤 Nome:</strong> ${nomeUsuario}</p>
                    <p><strong>📧 E-mail:</strong> ${emailUsuario}</p>
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 15px 0;">
                    <p style="font-size: 12px; color: #777;">Este é um aviso automático gerado pelo sistema Bingo Master Pro.</p>
                </div>
            `
        });

        console.log(`\n=== ✅ E-MAIL ENVIADO COM SUCESSO VIA RESEND ===`);
        console.log('ID da mensagem:', data.id);
    } catch (erro) {
        console.error('\n=== ❌ ERRO CRÍTICO NO ENVIO VIA RESEND ===');
        console.error(erro);
    }
}

module.exports = { alertarNovoCadastro };