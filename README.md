# Contas a Receber (React + Vite)

## Rodar local
1. `npm install`
2. `npm run dev`
3. Abra o endereço mostrado (ex.: http://localhost:5173)

## Build de produção
- `npm run build` -> gera a pasta `dist/`

## Publicar
- **Vercel**: conecte o repositório ou rode `vercel` no diretório do projeto.  
  Build: `npm run build` | Output: `dist`
- **Netlify**: conecte o repo (Build: `npm run build`, Publish dir: `dist`) **ou** arraste a pasta `dist` no Netlify Drop.
- **GitHub Pages**: publique o conteúdo de `dist/` na branch `gh-pages` (ajuste `base` no `vite.config` se for necessário).
