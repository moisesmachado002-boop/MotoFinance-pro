# MotoFinance PRO — Versão 1

Aplicativo PWA para controlar ganhos, gastos, veículos, odômetro e lembretes de manutenção. A interface é responsiva e funciona em celular e notebook.

## Recursos

- Painel mensal com ganhos, gastos e resultado real, inclusive negativo.
- Categorias para corridas, entregas, fretes, combustível, manutenção, impostos e outros.
- Cadastro e seleção de vários veículos.
- Registro dedicado de odômetro, com histórico e confirmação para correções que reduzam a leitura.
- Lembretes internos por quilometragem, tempo ou ambos, com pausa e histórico de conclusões.
- Gráficos por categoria, mês e veículo.
- Pesquisa e filtros no histórico financeiro.
- Backup JSON, restauração e exportação CSV.
- Funcionamento offline após o primeiro acesso.
- Metas semanais e mensais de ganhos.
- Importação automática de ganhos, combustível, manutenção, registros de km e metas compatíveis da versão anterior.

## Dados

Os dados ficam no navegador de cada aparelho e não são sincronizados automaticamente. Para levar os dados do celular ao notebook, faça um backup no primeiro aparelho e use **Restaurar backup** no segundo. O backup contém informações financeiras em texto simples; guarde-o em local privado.

Antes de restaurar, o aplicativo valida a versão, os veículos, as movimentações, os lembretes, os identificadores e o tamanho do arquivo. A substituição só ocorre depois da confirmação e de uma gravação bem-sucedida.

## Testes

Execute:

```bash
node tests/test_core.js
node tests/test_static.js
```

O conjunto cobre valores em formato brasileiro, datas e meses, placas, cálculos financeiros, filtros, categorias, odômetro e estados dos lembretes.
