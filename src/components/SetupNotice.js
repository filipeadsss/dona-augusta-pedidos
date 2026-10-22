export default function SetupNotice() {
  return (
    <div className="container">
      <div className="card">
        <h2>Falta conectar o banco de dados</h2>
        <p>
          O sistema está no ar, mas ainda não recebeu as chaves do Firebase. Cadastre as variáveis
          <b> NEXT_PUBLIC_FIREBASE_API_KEY</b>, <b>NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN</b>,{' '}
          <b>NEXT_PUBLIC_FIREBASE_PROJECT_ID</b> e <b>NEXT_PUBLIC_FIREBASE_APP_ID</b> no Vercel e faça um novo
          deploy. O passo a passo está no arquivo README.md do projeto.
        </p>
      </div>
    </div>
  );
}
