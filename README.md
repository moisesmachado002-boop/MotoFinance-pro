# MotoFinance PRO v6.1

Controle financeiro local para registrar receitas, combustível, manutenção e quilometragem de serviços como motoboy.

## Como abrir

Mantenha `index.html`, `style.css` e `script.js` na mesma pasta e abra o `index.html` no Chrome, Edge ou Firefox.

## Regras dos cálculos

- Lucro diário e semanal: receitas menos combustível.
- Lucro líquido mensal: receitas menos combustível e manutenção.
- Receitas de outras correrias entram normalmente no fechamento.

## Dados e backup

Os dados ficam salvos no navegador usado. Faça backups periódicos pelo botão **Backup**. A limpeza dos dados do navegador pode apagar lançamentos que não tenham sido exportados.

## Testes

Execute `node tests/test_core.js` para conferir os 18 grupos de testes automatizados.

Consulte também `LEIA-ME.txt` e `RELATORIO_DE_TESTES.txt`.
