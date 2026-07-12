const nodemailer = require('nodemailer');

// Configura o transportador usando as credenciais do seu .env
const transportador = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_REMETENTE,
        pass: process.env.EMAIL_SENHA_APP
    }
});

/**
 * Envia um e-mail de notificação de novo cadastro para o administrador
 * @param {string} nomeUsuario - Nome da pessoa que se cadastrou
 * @param {string} emailUsuario - E-mail que a pessoa usou no cadastro
 */
async function alertarNovoCadastro(nomeUsuario, emailUsuario) {
    const opcoesEmail = {
        from: `"Bingo Master Pro" <${process.env.EMAIL_REMETENTE}>`,
        to: process.env.EMAIL_DESTINO, 
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
    };

    try {
        await transportador.sendMail(opcoesEmail);
        console.log(`[E-mail] Alerta de cadastro de ${nomeUsuario} enviado com sucesso!`);
    } catch (erro) {
        console.error('[E-mail] Erro crítico ao enviar e-mail de alerta:', erro);
    }
}

module.exports = { alertarNovoCadastro };