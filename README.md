# Football-Manager-Lite
Football Manager Lite
# Football Manager Lite
https://profeniclas-lab.github.io/Football-Manager-Lite/

Simulador de 200 clubes em 2 divisões (100 cada). Turno único, 99 rodadas.
Sem dependências. 100% client-side. Salva automaticamente em `localStorage`.

## Deploy no GitHub Pages
1. Crie um repositório público no GitHub.
2. Faça upload dos arquivos mantendo a estrutura (`index.html`, `css/`, `js/`).
3. Settings → Pages → Source: `main` / `/root` → Save.
4. Acesse `https://seu-usuario.github.io/seu-repo/`.

## Como calibrar
- `HOME_ADV` (mando de campo): maior = mais vitória em casa.
- `NOISE` (zebras): maior = mais surpresas.
- `K` (sensibilidade): maior = placares mais elásticos em jogos desequilibrados.
- `BASE_GOALS` (média de gols): maior = jogos mais movimentados.
- `FORM_WEIGHT` (peso da forma): maior = forma recente pesa mais.
