"""CLI local: python -m rescueos --input eventos.jsonl --output-dir out."""

import argparse
import os
from pathlib import Path
import sys

from .ingest import read_jsonl
from .metrics import compute_metrics
from .replay import replay
from .reporting import build_reports, write_reports


def _run(argv):
    parser = argparse.ArgumentParser(description="RescueOS: replay e relatórios de eventos JSONL locais.")
    parser.add_argument("--input", required=True, type=Path, help="Arquivo JSONL de entrada (preservado).")
    parser.add_argument("--output-dir", required=True, type=Path, help="Diretório dos três relatórios.")
    args = parser.parse_args(argv)
    try:
        source = args.input.resolve(strict=True)
        if not source.is_file():
            raise ValueError("A entrada deve ser um arquivo regular.")
        ingestion = read_jsonl(source)
        projection = replay(ingestion)
        metrics = compute_metrics(projection)
        reports = build_reports(ingestion, projection, metrics)
        write_reports(reports, args.output_dir, input_path=source)
    except ValueError as error:
        print(f"RescueOS: parâmetros/caminhos inválidos: {error}", file=sys.stderr)
        return 2
    except OSError as error:
        print(f"RescueOS: falha de leitura/escrita: {error}", file=sys.stderr)
        return 1
    print(f"RescueOS: {len(metrics.orders)} pedidos reconstruídos; 3 relatórios publicados.")
    print(f"Diagnósticos: {len(ingestion.errors)} erros de dados; {len(ingestion.duplicates)} grupos duplicados; "
          f"{len(projection.inconsistencies)} inconsistências. Consulte errors.json.")
    return 0


def _silence_stream(name):
    # O buffer que falhou ainda pode ser descarregado pelo encerramento do Python.
    # Redirecionar o descritor existente evita esse segundo erro (código 120).
    stream = getattr(sys, name)
    try:
        descriptor = stream.fileno()
        null_descriptor = os.open(os.devnull, os.O_WRONLY)
        try:
            os.dup2(null_descriptor, descriptor)
        finally:
            if null_descriptor != descriptor:
                os.close(null_descriptor)
    except (AttributeError, OSError, ValueError):
        # Streams substituídos pelo chamador podem não possuir descritor.
        setattr(sys, name, None)


def _flush_streams():
    for stream in (sys.stdout, sys.stderr):
        if stream is not None:
            stream.flush()


def main(argv=None):
    try:
        # UTF-8 também nos pipes do Windows; reconfigure pode fazer flush.
        for stream in (sys.stdout, sys.stderr):
            if hasattr(stream, "reconfigure"):
                stream.reconfigure(encoding="utf-8", errors="backslashreplace")
        try:
            code = _run(argv)
        except SystemExit:
            _flush_streams()  # Inclui ajuda e erros produzidos pelo argparse.
            raise
        _flush_streams()
        return code
    except (OSError, ValueError) as error:
        _silence_stream("stdout")
        try:
            print(f"RescueOS: falha de I/O no terminal: {error}", file=sys.stderr)
            if sys.stderr is not None:
                sys.stderr.flush()
        except (OSError, ValueError):
            _silence_stream("stderr")
        return 1


if __name__ == "__main__":
    sys.exit(main())
