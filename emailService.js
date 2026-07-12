const nodemailer = require('nodemailer');
const dns = require('dns');

// Agora estamos lendo exatamente os nomes das chaves que estão no seu Render
const transportador = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, 
    auth: {
        user: process.env.SMTP_USER, // Mudamos para SMTP_USER
        pass: process.env.SMTP_PASS  // Mudamos para SMTP_PASS
    },
    tls: {
        ciphers: 'SSLv3',   // Ajuda a negociar a criptografia com o Gmail
        rejectUnauthorized: false // Evita falhas de certificado comuns em nuvem
    },           // 🌟 Ativa o SSL para a porta 465
    auth: {
        user: process.env.EMAIL_REMETENTE,
        pass: process.env.EMAIL_SENHA_APP
    },
    // 🔥 A MÁGICA ESTÁ AQUI: Força o Node.js a usar apenas IPv4 (ignora o IPv6 que dá erro)
    dnsLookup: (hostname, options, callback) => {
        dns.lookup(hostname, { family: 4 }, callback);
    }
});

async function alertarNovoCadastro(nomeUsuario, emailUsuario) {
    const opcoesEmail = {
        from: `"Bingo Master Pro" <${process.env.SMTP_USER}>`,
        to: process.env.ADMIN_EMAIL || process.env.SMTP_USER, // Usa o e-mail de admin ou o próprio usuário
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
        console.log(`\n=== ✅ E-MAIL ENVIADO COM SUCESSO PARA O ADMIN ===\n`);
    } catch (erro) {
        console.error('\n=== ❌ ERRO CRÍTICO NO ENVIO DE E-MAIL ===');
        console.error('O Gmail respondeu o seguinte problema:', erro.message);
        console.error('=============================================\n');
    }
}

module.exports = { alertarNovoCadastro };