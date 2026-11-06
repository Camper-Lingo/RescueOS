"""Benchmark prospectivo: regra fixa vs regressão logística para risco de atraso.

Os exemplos vêm do *simulador do frontend*, via export_nights.mjs.
Nunca usar estado final, IDs ou atributos do futuro como features.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from statistics import mean

import joblib
import numpy as np
from sklearn.dummy import DummyClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import confusion_matrix, precision_recall_fscore_support, balanced_accuracy_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

NUMERIC = [
    "created_minute", "kitchen_queue", "kitchen_backlog_minutes", "kitchen_fault_active",
    "prep_minutes", "courier_due_in", "delivery_minutes", "route_km",
    "courier_speed_kmh", "promised_in",
]
SCENARIOS = ("quiet", "medium", "busy")


def read_rows(path: Path) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8") as f:
        for line_number, line in enumerate(f, 1):
            if not line.strip():
                continue
            row = json.loads(line)
            if row.get("schema") != "rescueos.delivery_risk.v1" or row.get("scenario") not in SCENARIOS:
                raise ValueError(f"Esquema ou cenário inválido na linha {line_number}")
            if row.get("label_late") not in (None, 0, 1):
                raise ValueError(f"Rótulo inválido na linha {line_number}")
            if not isinstance(row.get("seed"), int) or not isinstance(row.get("order_id"), str):
                raise ValueError(f"Identificador inválido na linha {line_number}")
            features = row.get("features")
            if not isinstance(features, dict) or set(features) != set(NUMERIC):
                raise ValueError(f"Feature incorreta na linha {line_number}")
            for key in NUMERIC:
                if not isinstance(features[key], (int, float)) or not np.isfinite(features[key]):
                    raise ValueError(f"Valor inválido de {key} na linha {line_number}")
            rows.append(row)
    if not rows:
        raise ValueError("Dataset vazio")
    return rows


def split_by_seed(rows: list[dict]):
    """Uma semente inteira pertence a um único split, em TODOS os cenários."""
    seeds = sorted(set(row["seed"] for row in rows))
    if len(seeds) < 20:
        raise ValueError("Use pelo menos 20 sementes independentes")
    test_seeds = set(seeds[::5])
    train = [r for r in rows if r["seed"] not in test_seeds]
    test = [r for r in rows if r["seed"] in test_seeds]
    assert {r['seed'] for r in train}.isdisjoint({r['seed'] for r in test})
    return train, test


def vec(row: dict) -> dict:
    return {**row['features'], 'scenario': row['scenario']}


def fixed_rule(row: dict) -> int:
    """Regra simples definida antes de olhar o conjunto de teste."""
    f = row['features']
    predicted_completion = max(f['prep_minutes'] + f['kitchen_backlog_minutes'] / 2,
                               f['courier_due_in']) + 3 + f['delivery_minutes']
    return int(predicted_completion > f['promised_in'])


def scores(y, predicted):
    p, r, f1, _ = precision_recall_fscore_support(y, predicted, average='binary', zero_division=0)
    tn, fp, fn, tp = map(int, confusion_matrix(y, predicted, labels=[0,1]).ravel())
    return {
        'precision_late': round(float(p), 4),
        'recall_late': round(float(r), 4),
        'f1_late': round(float(f1), 4),
        'balanced_accuracy': round(float(balanced_accuracy_score(y, predicted)), 4),
        'confusion': {'true_negative':tn,'false_positive':fp,'false_negative':fn,'true_positive':tp},
    }


def training_report(rows: list[dict], out: Path) -> dict:
    train_all, test_all = split_by_seed(rows)
    train = [r for r in train_all if r['label_late'] is not None]
    test = [r for r in test_all if r['label_late'] is not None]
    if len({r['label_late'] for r in train}) < 2 or len({r['label_late'] for r in test}) < 2:
        raise ValueError('Dados insuficientes em uma das classes; aumente --seeds')
    feature_rows = [vec(r) for r in train]
    feature_test = [vec(r) for r in test]
    # Pipeline scikit-learn: preprocessador treinado SOMENTE no treino.
    # Um modelo pequeno o suficiente para CPU de notebook.
    from sklearn.feature_extraction import DictVectorizer
    model = Pipeline([
        ('vectorize', DictVectorizer(sparse=False)),
        ('scale', StandardScaler()),
        ('classify', LogisticRegression(max_iter=2000, class_weight='balanced', random_state=42)),
    ])
    model.fit(feature_rows, [r['label_late'] for r in train])
    y = [r['label_late'] for r in test]
    predicted_model = model.predict(feature_test).astype(int).tolist()
    predicted_rule = [fixed_rule(r) for r in test]
    dummy = DummyClassifier(strategy='most_frequent')
    dummy.fit(np.zeros((len(train), 1)), [r['label_late'] for r in train])
    predicted_dummy = dummy.predict(np.zeros((len(test), 1))).astype(int).tolist()

    metrics = {
        'always_majority': scores(y, predicted_dummy),
        'fixed_rule': scores(y, predicted_rule),
        'logistic_regression': scores(y, predicted_model),
    }
    per_scenario = {}
    for scenario in SCENARIOS:
        ix = [i for i, row in enumerate(test) if row['scenario'] == scenario]
        if not ix:
            continue
        per_scenario[scenario] = {
            'examples':len(ix), 'late_fraction':round(mean(y[i] for i in ix), 4),
            'model':scores([y[i] for i in ix], [predicted_model[i] for i in ix]),
        }
    errors = []
    for row, truth, pred in zip(test, y, predicted_model):
        if pred != truth and len(errors) < 12:
            errors.append({'seed': row['seed'], 'scenario':row['scenario'],
                           'order_id':row['order_id'], 'expected_late':truth, 'predicted_late':pred})
    result = {
        'objective':'Classificar risco de ENTREGA ATRASADA no instante de criação de pedido',
        'dataset':'Somente noites fictícias do motor RescueOS 7G/7H',
        'split':'Por semente: cada semente fica inteira em treino OU teste; nenhum pedido se repete',
        'features':'Apenas atributos observáveis no momento de criação, sem timestamps futuros nem rótulo',
        'limitations':[
            'Exemplos pendentes foram excluídos do treino e da avaliação: viés de seleção possível',
            'Simulador sintético não valida desempenho em dados reais de delivery',
            'Taxas e desempenho podem variar com sementes, configurações e versão do motor',
            'Métrica F1 é da classe atrasado; resultados dependem da prevalência de atraso',
        ],
        'counts': {'train_nights': len({(r['seed'],r['scenario']) for r in train_all}),
                   'test_nights': len({(r['seed'],r['scenario']) for r in test_all}),
                   'train_delivered':len(train), 'test_delivered':len(test),
                   'train_pending_excluded': len(train_all)-len(train),
                   'test_pending_excluded': len(test_all)-len(test),
                   'test_late_fraction': round(mean(y),4)},
        'metrics':metrics,
        'per_scenario':per_scenario,
        'model_errors_sample':errors,
    }
    out.mkdir(parents=True, exist_ok=True)
    (out/'results.json').write_text(json.dumps(result, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')
    md = [
        '# RescueOS AI Lab — primeiro benchmark', '',
        '**Pergunta:** ao receber o pedido, conseguimos prever se ele vai atrasar?', '',
        f"**Dataset:** {len(rows)} pedidos sintéticos; {result['counts']['train_delivered']} treino e {result['counts']['test_delivered']} teste com entrega concluída.",
        f"**Pendentes excluídos:** {result['counts']['train_pending_excluded']} no treino, {result['counts']['test_pending_excluded']} no teste.",
        '**Split:** por semente, nunca por linhas aleatórias.', '',
        '| Método | Precision (atraso) | Recall (atraso) | F1 (atraso) | Balanceada |',
        '| --- | ---: | ---: | ---: | ---: |',
    ]
    for name, m in metrics.items():
        md.append(f"| {name} | {m['precision_late']:.3f} | {m['recall_late']:.3f} | {m['f1_late']:.3f} | {m['balanced_accuracy']:.3f} |")
    md.extend(['', '## Performance por cenário (teste)', '', '| Cenário | Pedidos | % atrasos | F1 do ML |', '|---|---:|---:|---:|'])
    for name, sc in per_scenario.items():
        md.append(f"| {name} | {sc['examples']} | {100*sc['late_fraction']:.1f}% | {sc['model']['f1_late']:.3f} |")
    md.extend(['', '## Interpretação', '',
               'Não concluir que o modelo é melhor que a regra sem consultar os números, erros e distribuição por cenário.',
               'A comparação é **somente dentro de dados sintéticos gerados pelo mesmo simulador**.',
               'Há viés de sobrevivência: pedidos pendentes não têm rótulo de entrega no prazo/atrasada.',
               '', '## Próximos experimentos', '',
               '1. Adicionar casos de incidentes por tipo e validação de segurança do Scout.',
               '2. Medir repetibilidade em mais sementes e construir validação fora da distribuição.',
               '3. Testar o Qwen3:4b em amostra pequena com a mesma tarefa e gabarito, com monitoramento térmico.', ''])
    (out/'report.md').write_text('\n'.join(md), encoding='utf-8')
    joblib.dump(model, out/'delivery_risk_logreg.joblib')
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', type=Path, default=Path('ai_lab/data/delivery_risk.jsonl'))
    parser.add_argument('--out', type=Path, default=Path('ai_lab/out'))
    args = parser.parse_args()
    result = training_report(read_rows(args.data), args.out)
    print('Treino concluído. F1 da regra:', result['metrics']['fixed_rule']['f1_late'],
          '| F1 do modelo:', result['metrics']['logistic_regression']['f1_late'])
    print('Relatório:', args.out / 'report.md')


if __name__ == '__main__':
    main()
