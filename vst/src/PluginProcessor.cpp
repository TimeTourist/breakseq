#include "PluginProcessor.h"
#include "PluginEditor.h"

BreakseqProcessor::BreakseqProcessor()
    : AudioProcessor (BusesProperties().withOutput ("Output", juce::AudioChannelSet::stereo(), true))
{
}

void BreakseqProcessor::prepareToPlay (double, int)
{
}

bool BreakseqProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    return layouts.getMainOutputChannelSet() == juce::AudioChannelSet::stereo();
}

void BreakseqProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
    juce::ScopedNoDenormals noDenormals;
    buffer.clear();

    if (auto* head = getPlayHead())
        if (auto position = head->getPosition())
            if (auto hostBpm = position->getBpm())
                bpm.store (*hostBpm);

    const juce::SpinLock::ScopedTryLockType lock (soundLock);

    if (! lock.isLocked())
        return;

    // Renders up to each event, then applies it, so notes land on their sample.
    auto renderTo = [&] (int from, int to)
    {
        for (int i = from; i < to && playing; ++i)
        {
            if (position >= sound.size())
            {
                playing = false;
                break;
            }

            const auto s = sound[position++];

            for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
                buffer.setSample (ch, i, s);
        }
    };

    int done = 0;

    for (const auto metadata : midi)
    {
        const auto message = metadata.getMessage();
        const auto at = juce::jlimit (0, buffer.getNumSamples(), metadata.samplePosition);
        renderTo (done, at);
        done = at;

        if (message.getNoteNumber() != firstNote)
            continue;

        if (message.isNoteOn())
        {
            position = 0;
            playing = ! sound.empty();
        }
        else if (message.isNoteOff())
        {
            playing = false;
        }
    }

    renderTo (done, buffer.getNumSamples());
}

void BreakseqProcessor::setSound (std::vector<float> samples)
{
    const juce::SpinLock::ScopedLockType lock (soundLock);
    sound.swap (samples);
    position = 0;
    playing = false;
}

juce::AudioProcessorEditor* BreakseqProcessor::createEditor()
{
    return new BreakseqEditor (*this);
}

void BreakseqProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    juce::ValueTree state ("Breakseq");
    state.setProperty ("counter", counter.load(), nullptr);

    juce::MemoryOutputStream out (destData, false);
    state.writeToStream (out);
}

void BreakseqProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    const auto state = juce::ValueTree::readFromData (data, (size_t) sizeInBytes);

    if (state.hasType ("Breakseq"))
        counter.store ((int) state.getProperty ("counter", 0));
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new BreakseqProcessor();
}
