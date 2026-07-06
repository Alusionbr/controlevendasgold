# Controle360 Multi

Plataforma multiusuário (admin + vendedores) para controle de estoque, CMV, produção, vendas,
pedidos, tarefas e consignados. Backend em Supabase (Auth + Postgres + Row-Level Security).

## Papéis

- **admin**: acesso total ao negócio; cria/gerencia contas de vendedor; define preço padrão e piso
  por produto; aprova ou rejeita pedidos de reposição.
- **vendedor**: enxerga só os próprios clientes, vendas, consignados e pedidos (aplicado por RLS no
  banco); registra devolução/desperdício, vende do próprio estoque (vira consignado devido ao
  admin), acompanha metas e usa a calculadora.

## Como usar

1. Abra `index.html` (ou `controle360-mobile.html` no celular) no navegador.
2. Entre com e-mail e senha (ver `docs/backend.md` para como o primeiro admin é provisionado).
3. Admin: cadastre produtos, clientes, fornecedores e crie contas de vendedor em **Vendedores**.
4. Vendedor: cadastre seus clientes e lance vendas, pedidos e consignados.

## Para que serve

O projeto foi desenhado para ser configurável para vários tipos de operação:

- essências aromáticas;
- marmitas/alimentos;
- revenda de mercadorias;
- consignados;
- serviços que consomem materiais;
- kits e composições.

## Exemplo de uso para essência aromática

Cadastre como produtos:

- essência/base/fragrância como `Matéria-prima`;
- vidro como `Embalagem`;
- rótulo como `Embalagem`;
- caixa como `Embalagem`;
- tampa/válvula/lacre como `Embalagem`;
- produto final como `Produto final produzido`.

Depois monte a ficha técnica do produto final adicionando as quantidades de cada item por unidade produzida.

O sistema calcula:

- custo de materiais;
- mão de obra por unidade;
- custo fixo rateado;
- perda técnica;
- custo final por unidade;
- preço sugerido por margem desejada e taxas;
- CMV na venda.

## Estrutura

```txt
src/utils.js           helpers gerais
src/state.js           persistência e estado local
src/calculations.js    cálculos críticos
src/ui.js              componentes HTML simples
src/app.js             telas e fluxos
```

## Persistência

Os dados vivem no Postgres do Supabase; o LocalStorage do navegador é só um cache offline,
repovoado a cada login.

Use **Exportar backup** com frequência mesmo assim.

## Limitações atuais

- Não edita todos os registros ainda.
- Venda/pedido ainda é de um item por lançamento.
- Não controla lote/validade ainda.
- Não tem contas a pagar/receber completo.
- Um admin está vinculado a exatamente um negócio (criado no provisionamento inicial); não há
  autoatendimento para criar/excluir negócios pelo próprio app.

Essas limitações estão documentadas no roadmap.

## Backup, exportação e importação

A aba **Dados** (ou o botão "Baixar Excel" no topo) concentra três formatos:

- **Excel (.xlsx)** — backup completo com uma aba por módulo (Produtos, Vendas, Compras, Consignado, etc.), em português. Pode ser aberto e editado no Excel ou Google Sheets e reimportado. A aba `Backup_NAO_EDITAR` guarda as configurações para restaurar tudo; não a apague.
- **JSON** — cópia técnica fiel de todo o estado, incluindo configurações. Use como backup de segurança.
- **CSV por módulo** — uma tabela por vez, do negócio ativo (ou todos, no caso de Negócios).

Importar (Excel ou JSON) **substitui** os dados locais atuais. Faça um backup antes.

O motor de Excel é escrito em JavaScript puro (`src/xlsx-lite.js`), sem bibliotecas externas, e funciona offline. A importação de planilhas compactadas usa a API nativa do navegador; navegadores muito antigos podem não suportá-la — nesse caso, use o backup JSON.
